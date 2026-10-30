import { afterEach, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BrowserSession, browserProcessParameters, type BrowserTransportFactory } from './browser.js';
import { Runtime } from './runtime.js';
import { Agent } from './agent.js';
import { EventLog } from './log.js';
import { Registry, type Tool, type RunEvent } from '@wisp/core';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const task of cleanup.splice(0).reverse()) await task(); });
function fixture(options: { failProbe?: boolean; delayNavigation?: boolean } = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [], directories: string[] = [];
  const servers: Server[] = []; let cancellations = 0;
  const factory: BrowserTransportFactory = directory => {
    directories.push(directory); const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new Server({ name: 'offline-browser-protocol-fixture', version: '1' }, { capabilities: { tools: {} } }); servers.push(server);
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
      { name: 'browser_navigate', description: 'Navigate', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
      { name: 'browser_snapshot', description: 'Snapshot', inputSchema: { type: 'object', properties: { filename: { type: 'string' } } } },
      { name: 'browser_run_code', description: 'Must never be exposed', inputSchema: { type: 'object' } },
      { name: 'browser_file_upload', description: 'Must never be exposed', inputSchema: { type: 'object' } },
    ] }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const args = request.params.arguments ?? {}; calls.push({ name: request.params.name, args });
      if (args.url === 'about:blank' && options.failProbe) return { isError: true, content: [{ type: 'text', text: 'Sandbox/browser unavailable' }] };
      if (args.url !== 'about:blank' && request.params.name === 'browser_navigate' && options.delayNavigation) await new Promise<void>(resolve => { extra.signal.addEventListener('abort', () => { cancellations++; resolve(); }, { once: true }); });
      return { content: [{ type: 'text', text: 'offline fixture page' }] };
    });
    void server.connect(serverTransport); return clientTransport;
  };
  cleanup.push(async () => { for (const server of servers) await server.close(); });
  return { factory, calls, directories, servers, cancelled: () => cancellations };
}
it('initializes MCP, probes actual startup, filters tools and closes resources', async () => {
  const f = fixture(), session = new BrowserSession(() => {}, f.factory); cleanup.push(() => session.disconnect());
  expect(session.status.state).toBe('disabled'); await session.connect();
  expect(session.status.state).toBe('connected'); expect(f.calls).toEqual([{ name: 'browser_navigate', args: { url: 'about:blank' } }]);
  expect(session.tools().map(t => t.name)).toEqual(['pw_browser_navigate', 'pw_browser_snapshot']);
  expect(session.tools().every(t => t.requiresApproval)).toBe(true);
  const snapshot = session.tools().find(t => t.name === 'pw_browser_snapshot')!;
  expect(snapshot.inputSchema.properties).not.toHaveProperty('filename');
  await expect(snapshot.execute({ filename: '/tmp/escape' }, new AbortController().signal)).rejects.toThrow('Unsupported');
  const navigate = session.tools()[0];
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:secret@example.com']) await expect(navigate.execute({ url }, new AbortController().signal)).rejects.toThrow();
  await navigate.execute({ url: 'https://example.invalid' }, new AbortController().signal); expect(f.calls).toHaveLength(2);
  await session.disconnect(); expect(session.status.state).toBe('disabled'); await expect(stat(f.directories[0])).rejects.toThrow();
  await expect(navigate.execute({ url: 'https://example.invalid' }, new AbortController().signal)).rejects.toThrow('失效');
});
it('failed browser probe never reports connected and cleans its temporary directory', async () => {
  const f = fixture({ failProbe: true }), session = new BrowserSession(() => {}, f.factory);
  await expect(session.connect()).rejects.toThrow('Chromium 启动检查失败');
  expect(session.status.state).toBe('failed'); expect(session.tools()).toEqual([]); await expect(stat(f.directories[0])).rejects.toThrow();
});
it('cancels in-flight protocol work, closes browser and refuses stale tool references', async () => {
  const f = fixture({ delayNavigation: true }), session = new BrowserSession(() => {}, f.factory); cleanup.push(() => session.disconnect()); await session.connect();
  const controller = new AbortController(), tool = session.tools()[0];
  const call = tool.execute({ url: 'https://example.invalid' }, controller.signal);
  const rejection = expect(call).rejects.toThrow();
  await vi.waitFor(() => expect(f.calls).toHaveLength(2)); controller.abort(); await rejection; await session.disconnect();
  expect(session.status.state).toBe('disabled'); expect(f.cancelled()).toBe(1); await expect(stat(f.directories[0])).rejects.toThrow();
});
it('requires Host approval for protocol actions and keeps sessions independent', async () => {
  const f = fixture(), browser = new BrowserSession(() => {}, f.factory); cleanup.push(() => browser.disconnect()); await browser.connect();
  const directory = await mkdtemp(join(tmpdir(), 'wisp-browser-agent-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const registry = new Registry<Tool>(); browser.tools().forEach(tool => registry.register(tool.name, tool)); const events: RunEvent[] = [];
  const agent = new Agent({ generate: async messages => messages.some(m => m.role === 'tool') ? { text: 'done' } : { text: '', calls: [{ id: 'navigate-1', name: 'pw_browser_navigate', args: { url: 'https://example.invalid' } }] } }, registry, new EventLog(join(directory, 'events.jsonl')), event => events.push(event));
  const run = agent.run('navigate'); await vi.waitFor(() => expect(events.some(e => e.type === 'approval_requested')).toBe(true));
  expect(f.calls).toHaveLength(1); agent.approve(events[0].runId, 'navigate-1', false); await run; expect(f.calls).toHaveLength(1);
  const other = new BrowserSession(() => {}, f.factory); cleanup.push(() => other.disconnect()); await other.connect();
  expect(f.directories[0]).not.toBe(f.directories[1]); await browser.disconnect(); expect(other.status.state).toBe('connected');
});
it('reports per-session connection state and runtime shutdown cleans all transports', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wisp-browser-runtime-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const f = fixture(), runtime = new Runtime(directory, f.factory); cleanup.push(() => runtime.shutdown()); await runtime.init();
  const id = (await runtime.request({ type: 'session.create', title: 'browser' })).sessionId!;
  await expect(runtime.request({ type: 'browser.connect', sessionId: id })).rejects.toThrow('格式');
  await runtime.request({ type: 'browser.connect', sessionId: id, confirmed: true }); expect(runtime.snapshot().browserConnected).toBe(true);
  const other = (await runtime.request({ type: 'session.create', title: 'other' })).sessionId!;
  expect(runtime.snapshot().browserConnected).toBe(false); expect(runtime.snapshot().browserSessions?.[id].state).toBe('connected');
  await runtime.request({ type: 'browser.connect', sessionId: other, confirmed: true }); await runtime.shutdown();
  expect(runtime.snapshot().browserConnected).toBe(false); for (const path of f.directories) await expect(stat(path)).rejects.toThrow();
});
it('uses the installed official MCP server for handshake and discovery without launching Chromium', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wisp-official-mcp-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  vi.stubEnv('PLAYWRIGHT_MCP_NO_SANDBOX', '1'); vi.stubEnv('OPENAI_API_KEY', 'test-secret-must-not-propagate');
  const parameters = browserProcessParameters(directory);
  expect(parameters.args).toContain('--sandbox'); expect(parameters.args).not.toContain('--no-sandbox'); expect(parameters.args).not.toContain('--port');
  expect(parameters.env).not.toHaveProperty('OPENAI_API_KEY'); expect(parameters.env).not.toHaveProperty('PLAYWRIGHT_MCP_NO_SANDBOX');
  const transport = new StdioClientTransport(parameters), client = new Client({ name: 'wisp-protocol-check', version: '1' });
  transport.stderr?.on('data', () => {}); cleanup.push(() => client.close());
  await client.connect(transport, { timeout: 5000 }); const list = await client.listTools({}, { timeout: 5000 });
  expect(list.tools.some(tool => tool.name === 'browser_navigate')).toBe(true); expect(list.tools.some(tool => tool.name === 'browser_snapshot')).toBe(true);
  await client.close(); expect(transport.pid).toBeNull();
}, 15000);

it('marks unexpected MCP closure as failed and removes resources', async () => {
  const f = fixture(), session = new BrowserSession(() => {}, f.factory); cleanup.push(() => session.disconnect());
  await session.connect(); await f.servers[0].close();
  await vi.waitFor(() => expect(session.status.state).toBe('failed'));
  expect(session.tools()).toEqual([]);
  await vi.waitFor(async () => { await expect(stat(f.directories[0])).rejects.toThrow(); });
});
