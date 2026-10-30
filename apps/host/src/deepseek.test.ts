import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Registry, type Message, type ModelEvent, type Tool } from '@wisp/core';
import { deepseekProvider } from './deepseek.js';
import { Agent } from './agent.js';
import { EventLog } from './log.js';
import { ConversationStore } from './conversation.js';
const config = { provider: 'deepseek' as const, model: 'discovered-model', baseUrl: 'https://offline.invalid' };
const signal = () => new AbortController().signal;
const tools = [{ name: 'read', description: 'read', inputSchema: { type: 'object' } }];
const frame = (delta: object = {}, finish_reason: string | null = null, usage?: object) => ({ choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) });
function response(frames: object[], done = true, bytes = false) {
  const text = ': keepalive\r\n\r\ndata: \r\n\r\n' + frames.map(value => `data: ${JSON.stringify(value)}\r\n\r\n`).join('') + (done ? 'data: [DONE]\r\n\r\n' : '');
  const data = new TextEncoder().encode(text);
  return new Response(new ReadableStream<Uint8Array>({ start(controller) { if (bytes) for (const byte of data) controller.enqueue(new Uint8Array([byte])); else controller.enqueue(data); controller.close(); } }));
}
async function collect(provider: ReturnType<typeof deepseekProvider>, messages: Message[] = [{ role: 'user', text: 'hi' }], options: object = {}, abort = signal()) {
  const events: ModelEvent[] = [];
  for await (const event of provider.stream({ messages, tools, ...options }, { signal: abort })) events.push(event);
  return events;
}
const finish = (events: ModelEvent[]) => events.find((e): e is Extract<ModelEvent, { type: 'finish' }> => e.type === 'finish')!;
describe('DeepSeek offline Chat Completions', () => {
  it('parses bytewise UTF8/CRLF, keepalive, interleaved calls and final-frame usage', async () => {
    const fetcher = vi.fn(async () => response([
      frame({ reasoning_content: '思考🙂', content: '你好' }),
      frame({ tool_calls: [{ index: 1, id: 'b', type: 'function', function: { name: 'read', arguments: '{"x":' } }, { index: 0, id: 'a', function: { name: 'read', arguments: '{' } }] }),
      frame({ tool_calls: [{ index: 0, function: { arguments: '}' } }, { index: 1, function: { arguments: '2}' } }] }),
      frame({}, 'tool_calls', { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17, prompt_cache_hit_tokens: 8, prompt_cache_miss_tokens: 4, completion_tokens_details: { reasoning_tokens: 3 } }),
    ], true, true));
    const events = await collect(deepseekProvider(config, 'fake-key', { fetch: fetcher }));
    expect(events.filter(e => e.type === 'usage')).toEqual([{ type: 'usage', usage: { input: 12, output: 5, total: 17, cacheHit: 8, cacheMiss: 4, reasoning: 3 } }]);
    expect(finish(events).message).toMatchObject({ text: '你好', calls: [{ id: 'a', args: {} }, { id: 'b', args: { x: 2 } }], continuation: { reasoning: '思考🙂' } });
    expect(events.at(-1)?.type).toBe('finish');
  });
  it.each(['stop', 'length', 'content_filter', 'insufficient_system_resource', 'aborted', 'future_reason'])('preserves raw finish %s', async reason => {
    const events = await collect(deepseekProvider(config, 'fake', { fetch: async () => response([frame({ content: 'part' }, reason)]) }));
    expect(finish(events).reason).toBe(reason);
  });
  it.each([400, 401, 402, 422, 429, 500, 503])('classifies HTTP %s without exposing response secrets', async status => {
    const fetcher = vi.fn(async () => new Response('fake-key sensitive upstream body', { status }));
    const events = await collect(deepseekProvider(config, 'fake-key', { fetch: fetcher, retryDelayMs: 1 }));
    expect(events.at(-1)).toMatchObject({ type: 'error', code: `http_${status}`, status, partial: false });
    expect(fetcher).toHaveBeenCalledTimes([429, 500, 503].includes(status) ? 3 : 1);
    expect(JSON.stringify(events)).not.toContain('fake-key');
  });
  it('rejects unsupported options before transport', async () => {
    const fetcher = vi.fn(); const provider = deepseekProvider(config, 'fake', { fetch: fetcher });
    for (const options of [{ toolChoice: 'required' }, { toolChoice: { name: 'read' } }, { parallel_tool_calls: true }, { responseFormat: 'json_schema' }]) expect((await collect(provider, undefined, options)).at(-1)).toMatchObject({ code: expect.stringContaining('unsupported') });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('detects premature EOF even after finish and never replays partial output', async () => {
    const fetcher = vi.fn(async () => response([frame({ content: 'partial' }, 'stop')], false));
    const events = await collect(deepseekProvider(config, 'fake', { fetch: fetcher }));
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'premature_eof', partial: true });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(events.some(e => e.type === 'finish')).toBe(false);
  });
  it('does not execute malformed tool arguments', async () => {
    const events = await collect(deepseekProvider(config, 'fake', { fetch: async () => response([frame({ tool_calls: [{ index: 0, id: 'x', function: { name: 'read', arguments: 'not json' } }] }, 'tool_calls')]) }));
    expect(events.at(-1)).toMatchObject({ code: 'invalid_tool_arguments' });
  });
  it('supports disabled thinking and JSON object without claiming schema validation', async () => {
    let payload: any;
    await collect(deepseekProvider({ ...config, thinking: 'disabled', effort: 'low' }, 'fake', { fetch: async (_, init) => { payload = JSON.parse(String(init?.body)); return response([frame({ content: '{}' }, 'stop')]); } }), undefined, { toolChoice: 'required', responseFormat: 'json_object' });
    expect(payload).toMatchObject({ thinking: { type: 'disabled' }, reasoning_effort: 'low', tool_choice: 'required', response_format: { type: 'json_object' } });
    expect(payload).not.toHaveProperty('parallel_tool_calls');
  });
  it('discovers optional metadata without inferring capabilities from names', async () => {
    const provider = deepseekProvider(config, 'fake', { fetch: async () => Response.json({ data: [{ id: 'unknown' }, { id: 'rich', name: 'Rich', context_window: 42, max_output_tokens: 7, input_modalities: ['text'], effort: { supported_levels: ['high'], default_level: 'high' } }] }) });
    expect(await provider.listModels({ signal: signal() })).toEqual([{ id: 'unknown' }, { id: 'rich', name: 'Rich', contextWindow: 42, maxOutputTokens: 7, inputModalities: ['text'], effort: { supportedLevels: ['high'], defaultLevel: 'high' } }]);
  });
  it.each(['cancelled', 'timeout'])('closes transport on %s', async mode => {
    const controller = new AbortController(); let transportSignal: AbortSignal | undefined;
    const fetcher: typeof fetch = async (_, init) => { transportSignal = init?.signal as AbortSignal; return await new Promise((_, reject) => { transportSignal!.addEventListener('abort', () => reject(transportSignal!.reason), { once: true }); }); };
    const pending = collect(deepseekProvider(config, 'fake', { fetch: fetcher, timeoutMs: mode === 'timeout' ? 10 : 1000 }), undefined, {}, controller.signal);
    if (mode === 'cancelled') controller.abort();
    expect((await pending).at(-1)).toMatchObject({ type: 'error', code: mode }); expect(transportSignal?.aborted).toBe(true);
  });
  it('persists all reasoning turns across two tool rounds and restart; isolates provenance and credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wisp-model-')); const id = randomUUID();
    try {
      const store = new ConversationStore(directory, id), messages: Message[] = [{ role: 'user', text: 'hi' }]; let round = 0; const payloads: any[] = [];
      const fetcher: typeof fetch = async (_, init) => {
        payloads.push(JSON.parse(String(init?.body))); round++;
        return round <= 2 ? response([frame({ reasoning_content: `private-${round}`, tool_calls: [{ index: 0, id: `c${round}`, function: { name: 'read', arguments: '{}' } }] }, 'tool_calls')]) : response([frame({ reasoning_content: 'private-final', content: 'done' }, 'stop')]);
      };
      for (let n = 0; n < 3; n++) {
        const message = finish(await collect(deepseekProvider(config, 'fake', { fetch: fetcher }), messages)).message; messages.push(message);
        if (message.calls?.length) messages.push({ role: 'tool', text: 'result', callId: message.calls[0].id });
      }
      await store.save(messages, value => value.replaceAll('fake-key', '[REDACTED]'));
      const restored = await new ConversationStore(directory, id).read();
      await collect(deepseekProvider(config, 'fake', { fetch: fetcher }), [...restored!, { role: 'user', text: 'next' }]);
      expect(payloads.at(-1).messages.filter((m: any) => m.role === 'assistant').map((m: any) => m.reasoning_content)).toEqual(['private-1', 'private-2', 'private-final']);
      await collect(deepseekProvider({ ...config, model: 'different' }, 'fake', { fetch: fetcher }), restored, { tools: [] });
      expect(JSON.stringify(payloads.at(-1))).not.toContain('private-');
      expect((await stat(join(directory, 'private-conversations', `${id}.json`))).mode & 0o777).toBe(0o600);
      await store.save([...messages, { role: 'user', text: 'fake-key' }], value => value.replaceAll('fake-key', '[REDACTED]'));
      expect(await readFile(join(directory, 'private-conversations', `${id}.json`), 'utf8')).not.toContain('fake-key');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('retries only model transport and never duplicates executed tools; keeps reasoning out of events', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wisp-model-agent-'));
    try {
      let requests = 0, effects = 0; const events: any[] = [], tools = new Registry<Tool>();
      tools.register('read', { name: 'read', description: 'read', inputSchema: {}, requiresApproval: false, async execute() { effects++; return 'actual result'; } });
      const fetcher: typeof fetch = async () => { requests++; if (requests === 2) return new Response('', { status: 503 }); return requests === 1 ? response([frame({ reasoning_content: 'private-thought', tool_calls: [{ index: 0, id: 'once', function: { name: 'read', arguments: '{}' } }] }, 'tool_calls')]) : response([frame({ reasoning_content: 'private-final', content: 'done' }, 'stop')]); };
      const store = new ConversationStore(directory, randomUUID());
      await new Agent(deepseekProvider(config, 'fake', { fetch: fetcher, retryDelayMs: 1 }), tools, new EventLog(join(directory, 'events.jsonl')), event => events.push(event), undefined, x => x, 0, messages => store.save(messages, x => x)).run('do once');
      expect(effects).toBe(1); expect(requests).toBe(3); expect(events.at(-1).type).toBe('completed');
      expect(await readFile(join(directory, 'events.jsonl'), 'utf8')).not.toContain('private-');
      const recovered = await store.read(); expect(recovered?.some(m => m.continuation?.reasoning === 'private-final')).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('recovers interrupted tools as unknown without replaying them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wisp-interrupted-'));
    try { const store = new ConversationStore(directory, randomUUID()); await store.save([{ role: 'assistant', text: '', calls: [{ id: 'a', name: 'write', args: {} }] }], x => x); expect((await store.read())?.at(-1)).toMatchObject({ role: 'tool', callId: 'a', isError: true, text: expect.stringContaining('unknown') }); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
});
it('preserves upstream error codes and non-success finish even with incomplete tool JSON', async () => {
  const errors = await collect(deepseekProvider(config, 'fake-key', { fetch: async () => Response.json({ error: { code: 'invalid_api_key', message: 'fake-key' } }, { status: 401 }) }));
  expect(errors.at(-1)).toMatchObject({ code: 'http_401', providerCode: 'invalid_api_key' });
  const truncated = await collect(deepseekProvider(config, 'fake', { fetch: async () => response([frame({ tool_calls: [{ index: 0, id: 'a', function: { name: 'read', arguments: '{' } }] }, 'length')]) }));
  expect(finish(truncated).reason).toBe('length');
});
it('cancels an actual loopback HTTP streaming connection after partial output', async () => {
  const { createServer } = await import('node:http');
  let closed!: () => void; const closure = new Promise<void>(resolve => { closed = resolve; });
  const server = createServer((_, reply) => { reply.on('close', closed); reply.writeHead(200, { 'content-type': 'text/event-stream' }); reply.write(`data: ${JSON.stringify(frame({ content: 'partial' }))}\n\n`); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const controller = new AbortController(); const events: ModelEvent[] = [];
    const provider = deepseekProvider({ ...config, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` }, 'fake');
    for await (const event of provider.stream({ messages: [{ role: 'user', text: 'hi' }], tools: [] }, { signal: controller.signal })) { events.push(event); if (event.type === 'text_delta') controller.abort(); }
    await closure;
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'cancelled', partial: true });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
it('runs the actual Runtime through DeepSeek transport, approval, restart and private history', async () => {
  const { Runtime } = await import('./runtime.js'); const { createServer } = await import('node:http'); const { mkdir } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'wisp-deepseek-runtime-')), directory = join(root, 'private'), workspace = join(root, 'work'); await mkdir(workspace);
  let count = 0; const payloads: any[] = [];
  const server = createServer(async (request, reply) => {
    let text = ''; for await (const chunk of request) text += chunk; payloads.push(JSON.parse(text)); count++;
    const answer = count === 1 ? frame({ reasoning_content: 'private-write-plan', tool_calls: [{ index: 0, id: 'write1', function: { name: 'files_write', arguments: '{"path":"result.txt","content":"approved content"}' } }] }, 'tool_calls') : frame({ reasoning_content: 'private-answer', content: 'finished' }, 'stop');
    reply.writeHead(200, { 'content-type': 'text/event-stream' }); reply.end(`data: ${JSON.stringify(answer)}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const localConfig = { ...config, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
  let runtime = new Runtime(directory);
  try {
    await runtime.init(); const sessionId = (await runtime.request({ type: 'session.create', title: 'real host fixture' })).sessionId!;
    await runtime.request({ type: 'workspace.grant', sessionId, path: workspace, confirmed: true });
    await runtime.request({ type: 'model.save', config: localConfig, apiKey: 'fake-runtime-key' });
    await runtime.request({ type: 'run.start', sessionId, prompt: 'write once', maxSteps: 4 });
    await vi.waitFor(() => expect(runtime.snapshot().events.some(e => e.type === 'approval_requested')).toBe(true));
    await expect(readFile(join(workspace, 'result.txt'))).rejects.toThrow();
    const approval = runtime.snapshot().events.find(e => e.type === 'approval_requested')!;
    await runtime.request({ type: 'run.approve', sessionId, runId: approval.runId, callId: 'write1', allowed: true });
    await vi.waitFor(() => expect(runtime.snapshot().events.at(-1)?.type).toBe('completed'));
    expect(await readFile(join(workspace, 'result.txt'), 'utf8')).toBe('approved content');
    await vi.waitFor(() => expect(runtime.snapshot().sessions[0].activeRunId).toBeUndefined());
    await runtime.shutdown(); runtime = new Runtime(directory); await runtime.init();
    expect(runtime.snapshot().keyPresent).toBe(false);
    await runtime.request({ type: 'model.save', config: localConfig, apiKey: 'fake-runtime-key' });
    await runtime.request({ type: 'run.start', sessionId, prompt: 'continue', maxSteps: 4 });
    await vi.waitFor(() => expect(runtime.snapshot().events.filter(e => e.type === 'completed')).toHaveLength(2));
    expect(payloads.at(-1).messages.filter((m: any) => m.role === 'assistant').map((m: any) => m.reasoning_content)).toEqual(['private-write-plan', 'private-answer']);
    expect(payloads.at(-1).messages.some((m: any) => m.role === 'tool' && m.tool_call_id === 'write1')).toBe(true);
    expect(JSON.stringify(runtime.snapshot())).not.toContain('private-write-plan');
    for (const file of [join(directory, 'state.json'), join(directory, 'sessions', `${sessionId}.jsonl`), join(directory, 'private-conversations', `${sessionId}.json`)]) expect(await readFile(file, 'utf8')).not.toContain('fake-runtime-key');
  } finally { await runtime.shutdown(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});
it('requires a fresh session for incompatible private history when thinking with tools', async () => {
  const fetcher = vi.fn();
  const events = await collect(deepseekProvider(config, 'fake', { fetch: fetcher }), [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'old unprovenanced answer' }]);
  expect(events.at(-1)).toMatchObject({ type: 'error', code: 'incompatible_history_start_new_session' }); expect(fetcher).not.toHaveBeenCalled();
});
