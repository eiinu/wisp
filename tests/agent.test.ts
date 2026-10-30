import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../apps/host/src/agent.js';
import { EventLog } from '../apps/host/src/log.js';
import { mockProvider, echoTool } from '../apps/host/src/mock.js';
import { Registry, requestSchema, type GenerationProvider, type RunEvent, type Tool } from '../packages/core/src/index.js';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function setup(provider: GenerationProvider = mockProvider, tool: Tool = echoTool) {
  const dir = await mkdtemp(join(tmpdir(), 'wisp-test-')); dirs.push(dir);
  const log = new EventLog(join(dir, 'events.jsonl')), events: RunEvent[] = [], tools = new Registry<Tool>(); tools.register(tool.name, tool);
  const agent = new Agent(provider, tools, log, event => events.push(event));
  return { agent, events, log };
}
async function pending(events: RunEvent[]) { await vi.waitFor(() => expect(events.some(e => e.type === 'approval_requested')).toBe(true)); return events.find(e => e.type === 'approval_requested')!; }
describe('agent safety and persistence', () => {
  it('round trips approved mock execution through JSONL', async () => {
    const { agent, events, log } = await setup(); const run = agent.run('hello'); const request = await pending(events);
    agent.approve(request.runId, String(request.data.id), true); await run;
    expect(events.at(-1)?.type).toBe('completed'); expect(events.some(e => e.type === 'tool_result' && e.data.text === 'hello')).toBe(true);
    expect(await new EventLog(log.path).read()).toEqual(events);
  });
  it('never executes denied tools or accepts stale approvals', async () => {
    const execute = vi.fn(echoTool.execute); const { agent, events } = await setup(mockProvider, { ...echoTool, execute });
    const run = agent.run('hello'); const request = await pending(events);
    expect(() => agent.approve('wrong', String(request.data.id), true)).toThrow();
    agent.approve(request.runId, String(request.data.id), false); await run;
    expect(execute).not.toHaveBeenCalled(); expect(events.at(-1)?.type).toBe('completed');
    expect(() => agent.approve(request.runId, String(request.data.id), true)).toThrow();
  });
  it('cancels approval and permits the next run', async () => {
    const execute = vi.fn(echoTool.execute); const { agent, events } = await setup(mockProvider, { ...echoTool, execute });
    const run = agent.run('hello'); const request = await pending(events); agent.cancel(request.runId); await run;
    expect(events.at(-1)?.type).toBe('cancelled'); expect(execute).not.toHaveBeenCalled();
    const next = agent.run('again'); await vi.waitFor(() => expect(events.filter(e => e.type === 'approval_requested')).toHaveLength(2));
    agent.cancel(events.at(-1)!.runId); await next;
  });
  it('cancels a provider that ignores AbortSignal and rejects concurrent runs', async () => {
    const { agent, events } = await setup({ generate: () => new Promise(() => {}) });
    const run = agent.run('hello'); await vi.waitFor(() => expect(events).toHaveLength(1));
    await expect(agent.run('concurrent')).rejects.toThrow('already active'); agent.cancel(events[0].runId); await run;
    expect(events.at(-1)?.type).toBe('cancelled');
  });
  it('stops an endless model at the step budget', async () => {
    const execute = vi.fn(echoTool.execute);
    let calls = 0;
    const { agent, events } = await setup({ generate: async () => ({ text: '', calls: [{ id: `loop-${++calls}`, name: 'demo.echo', args: { text: 'x' } }] }) }, { ...echoTool, requiresApproval: false, execute });
    await agent.run('hello', 2); expect(execute).toHaveBeenCalledTimes(2); expect(events.at(-1)?.data.reason).toBe('Step budget exhausted');
  });
  it('fails unknown tools without running anything', async () => {
    const { agent, events } = await setup({ generate: async () => ({ text: '', calls: [{ id: 'x', name: 'unknown', args: {} }] }) });
    await agent.run('hello'); expect(events.at(-1)?.type).toBe('failed');
  });
  it('rejects corrupt logs without silently discarding data', async () => {
    const { log } = await setup(); expect(await log.read()).toEqual([]); await writeFile(log.path, '{broken'); await expect(log.read()).rejects.toThrow('line 1');
  });
  it('validates IPC commands and registration names', () => {
    expect(requestSchema.safeParse({ type: 'start', prompt: ' ', maxSteps: 100 }).success).toBe(false);
    expect(requestSchema.safeParse({ type: 'approve', runId: 'bad', callId: 'x', allowed: 'yes' }).success).toBe(false);
    const registry = new Registry(); registry.register('x', {}); expect(() => registry.register('x', {})).toThrow('Duplicate');
  });
});

it('cancels a running cooperative tool and does not schedule the next call', async () => {
  const execute = vi.fn((_args, signal: AbortSignal) => new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })));
  const { agent, events } = await setup({ generate: async () => ({ text: '', calls: [{ id: 'a', name: 'demo.echo', args: {} }, { id: 'b', name: 'demo.echo', args: {} }] }) }, { ...echoTool, requiresApproval: false, execute });
  const run = agent.run('hello'); await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1)); agent.cancel(events[0].runId); await run;
  expect(execute.mock.calls[0][1].aborted).toBe(true); expect(execute).toHaveBeenCalledTimes(1); expect(events.at(-1)?.type).toBe('cancelled');
});
it('rejects reused tool call IDs instead of confusing approval history', async () => {
  const execute = vi.fn(echoTool.execute);
  const { agent, events } = await setup({ generate: async () => ({ text: '', calls: [{ id: 'repeated', name: 'demo.echo', args: { text: 'x' } }] }) }, { ...echoTool, requiresApproval: false, execute });
  await agent.run('hello', 3); expect(execute).toHaveBeenCalledTimes(1); expect(events.at(-1)?.data.reason).toContain('unique');
});
it('redacts a configured secret even when it spans streamed chunks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wisp-redact-')); dirs.push(dir);
  const events: RunEvent[] = [], secret = 'test-secret-value', log = new EventLog(join(dir, 'events.jsonl'));
  const agent = new Agent({ generate: async (_messages, _tools, _signal, onText) => { onText?.('prefix test-sec'); onText?.('ret-value suffix'); return { text: `prefix ${secret} suffix` }; } }, new Registry<Tool>(), log, event => events.push(event), undefined, text => text.split(secret).join('[REDACTED]'), secret.length);
  await agent.run(`prompt ${secret}`);
  expect(JSON.stringify(await log.read())).not.toContain(secret);
  expect(events.filter(e => e.type === 'assistant_delta').map(e => e.data.text).join('')).toBe('prefix [REDACTED] suffix');
});
it('binds approval to copied arguments and never exposes live tool implementations to the provider', async () => {
  const args = { text: 'approved content' }, execute = vi.fn(echoTool.execute);
  const provider: GenerationProvider = { generate: async (messages, specs) => {
    expect(specs[0]).not.toHaveProperty('execute'); expect(specs[0]).not.toHaveProperty('requiresApproval');
    // Mutating a model-visible schema cannot mutate the registered Host tool.
    specs[0].inputSchema.type = 'mutated';
    return messages.some(m => m.role === 'tool') ? { text: 'done' } : { text: '', calls: [{ id: 'immutable', name: 'demo.echo', args }] };
  } };
  const { agent, events } = await setup(provider, { ...echoTool, execute });
  const run = agent.run('test'); const request = await pending(events);
  args.text = 'unapproved replacement';
  agent.approve(request.runId, 'immutable', true); await run;
  expect(execute).toHaveBeenCalledWith({ text: 'approved content' }, expect.any(AbortSignal));
  expect(events.find(e => e.type === 'tool_result')?.data.text).toBe('approved content'); expect(echoTool.inputSchema.type).toBe('object');
});
