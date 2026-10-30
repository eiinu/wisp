import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { Registry, type Tool, type BrowserStatus } from '@wisp/core';
import { registerMcpTools } from './mcp.js';

export const browserToolNames = new Set([
  'browser_navigate', 'browser_navigate_back', 'browser_snapshot', 'browser_click',
  'browser_type', 'browser_press_key', 'browser_select_option', 'browser_wait_for',
  'browser_tabs', 'browser_hover',
]);
export function validateBrowserArgs(name: string, args: Record<string, unknown>) {
  if (!browserToolNames.has(name)) throw new Error('浏览器工具不在允许列表中');
  if (Object.hasOwn(args, 'url')) {
    if (typeof args.url !== 'string') throw new Error('URL 必须是字符串');
    let url: URL; try { url = new URL(args.url); } catch { throw new Error('无效的网页 URL'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('浏览器仅允许不含凭据的 HTTP(S) 网页');
  }
  if (name === 'browser_navigate' && !args.url) throw new Error('缺少网页 URL');
  if (name === 'browser_wait_for' && typeof args.time === 'number' && (args.time < 0 || args.time > 10)) throw new Error('单次浏览器等待最多 10 秒');
}
export function browserProcessParameters(directory: string): StdioServerParameters {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js');
  const env: Record<string, string> = {};
  // Preserve OS/browser/proxy configuration, never inherit model keys, arbitrary MCP flags or NODE_OPTIONS.
  for (const name of ['PATH', 'HOME', 'USER', 'LOGNAME', 'USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) {
    if (process.env[name]) env[name] = process.env[name]!;
  }
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
  const args = [cli, '--browser', 'chromium', '--sandbox', '--headless', '--isolated', '--no-webmcp', '--block-service-workers', '--codegen', 'none', '--image-responses', 'omit', '--output-dir', directory, '--timeout-action', '5000', '--timeout-navigation', '10000'];
  // A trusted local launch option, never accepted from renderer requests or model tools.
  if (process.env.WISP_CHROMIUM_PATH) args.push('--executable-path', process.env.WISP_CHROMIUM_PATH);
  return { command: process.execPath, args, env, cwd: directory, stderr: 'pipe', maxBufferSize: 4 * 1024 * 1024 };
}
export type BrowserTransportFactory = (directory: string) => Transport;
interface Connection { client: Client; transport: Transport; directory: string; registry: Registry<Tool> }
export class BrowserSession {
  status: BrowserStatus = { state: 'disabled', toolCount: 0, message: '尚未启用此会话的浏览器自动化' };
  private connection?: Connection;
  private generation = 0;
  private closing = Promise.resolve();
  private cleanups = new WeakMap<Connection, Promise<void>>();
  constructor(private changed: () => void, private factory: BrowserTransportFactory = directory => new StdioClientTransport(browserProcessParameters(directory))) {}
  private state(status: BrowserStatus) { this.status = status; this.changed(); }
  async connect() {
    if (this.status.state === 'connected') return;
    if (this.status.state === 'connecting') throw new Error('浏览器正在连接');
    const generation = ++this.generation;
    this.state({ state: 'connecting', toolCount: 0, message: '正在启动隔离的本机 Chromium 与 Playwright MCP' });
    let connection: Connection | undefined;
    let stage = 'MCP 连接';
    try {
      const directory = await mkdtemp(join(tmpdir(), 'wisp-browser-'));
      if (generation !== this.generation) { await rm(directory, { recursive: true, force: true }); return; }
      const client = new Client({ name: 'wisp-local-browser', version: '0.1.0' }, { capabilities: {} });
      let transport: Transport;
      try { transport = this.factory(directory); } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
      if (transport instanceof StdioClientTransport) transport.stderr?.on('data', () => {}); // Drain without persisting browser/account output.
      connection = { client, transport, directory, registry: new Registry<Tool>() }; this.connection = connection;
      const current = connection;
      client.onclose = () => { if (this.connection === current) { this.connection = undefined; ++this.generation; this.state({ state: 'failed', toolCount: 0, message: '浏览器 MCP 已断开，请明确重新连接' }); void this.dispose(current); } };
      await client.connect(transport, { timeout: 4000 });
      await registerMcpTools(client, 'pw', current.registry, { allowedNames: browserToolNames, omitParameters: ['filename'], validate: validateBrowserArgs });
      if (!current.registry.values().some(tool => tool.name === 'pw_browser_navigate')) throw new Error('Required tool missing');
      stage = 'Chromium 启动检查';
      // Local blank page forces real browser startup; a mere MCP handshake is not connected status.
      const probe = await client.callTool({ name: 'browser_navigate', arguments: { url: 'about:blank' } }, undefined, { timeout: 8000 });
      if (probe.isError) throw new Error('Browser probe failed');
      if (generation !== this.generation || this.connection !== current) return;
      this.state({ state: 'connected', toolCount: current.registry.values().length, message: '本机会话独立浏览器已连接；每次工具调用仍需批准' });
    } catch {
      if (connection && this.connection === connection) this.connection = undefined;
      if (connection) await this.dispose(connection);
      if (generation === this.generation) this.state({ state: 'failed', toolCount: 0, message: `${stage}失败。请检查本机 Chromium 安装与沙箱支持；没有关闭沙箱或自动安装浏览器。` });
      throw new Error(this.status.message ?? '浏览器连接失败');
    }
  }
  tools(): Tool[] {
    const connection = this.connection;
    if (!connection || this.status.state !== 'connected') return [];
    return connection.registry.values().map(tool => ({ ...tool, execute: async (args, signal) => {
      if (this.connection !== connection || this.status.state !== 'connected') throw new Error('原浏览器连接已失效，请重新启动任务');
      signal.throwIfAborted();
      const abort = () => { void this.disconnect('任务取消，已关闭该会话的浏览器'); };
      signal.addEventListener('abort', abort, { once: true });
      try { return await tool.execute(args, signal); } finally { signal.removeEventListener('abort', abort); }
    } }));
  }
  async disconnect(message = '浏览器已断开；隔离配置和临时输出已清理') {
    ++this.generation; const connection = this.connection; this.connection = undefined;
    this.state({ state: 'disabled', toolCount: 0, message });
    if (connection) await this.dispose(connection);
    await this.closing;
  }
  private dispose(connection: Connection): Promise<void> {
    const previous = this.cleanups.get(connection); if (previous) return previous;
    const task = (async () => {
      await connection.client.close().catch(() => {});
      await connection.transport.close().catch(() => {});
      await rm(connection.directory, { recursive: true, force: true }).catch(() => {});
    })();
    this.cleanups.set(connection, task);
    this.closing = Promise.all([this.closing, task]).then(() => {});
    return task;
  }
}
