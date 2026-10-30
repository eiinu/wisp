import { it, expect, vi } from 'vitest';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { piProvider } from './pi.js';
import { echoTool } from './mock.js';
import type { Message } from '@wisp/core';
it('uses the successor pi API offline, preserving native calls and error results', async () => {
  const faux = fauxProvider(); const models = createModels(); models.setProvider(faux.provider);
  const native = fauxAssistantMessage([fauxToolCall('demo.echo', { text: 'hello' }, { id: 'c1' })], { stopReason: 'toolUse' });
  faux.setResponses([native, context => {
    const transcript = context.messages.filter(m => m.role !== 'system');
    expect(transcript.map(m => m.role)).toEqual(['user', 'assistant', 'toolResult']);
    expect(transcript[1].content).toEqual(native.content);
    expect(transcript[2]).toMatchObject({ toolCallId: 'c1', isError: true });
    return fauxAssistantMessage('understood');
  }]);
  const complete = vi.spyOn(models, 'completeSimple');
  const provider = piProvider(faux.getModel(), models), signal = new AbortController().signal;
  const messages: Message[] = [{ role: 'user', text: 'hello' }];
  const first = await provider.generate(messages, [echoTool], signal);
  expect(first.calls).toEqual([{ id: 'c1', name: 'demo.echo', args: { text: 'hello' } }]);
  messages.push({ role: 'tool', text: 'Denied', toolName: 'demo.echo', callId: 'c1', isError: true });
  expect((await provider.generate(messages, [echoTool], signal)).text).toBe('understood');
  expect(complete.mock.calls[0][2]?.signal).toBe(signal);
});
it('does not treat a truncated model response as success', async () => {
  const faux = fauxProvider(); const models = createModels(); models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage('truncated', { stopReason: 'length' })]);
  await expect(piProvider(faux.getModel(), models).generate([{ role: 'user', text: 'hi' }], [], new AbortController().signal)).rejects.toThrow('length');
});

it('streams through the configured provider into a local fake API without external requests', async () => {
  const { createServer } = await import('node:http');
  const { configuredProvider } = await import('./pi.js');
  let authorization = '', payload: any;
  const server = createServer(async (request, response) => {
    authorization = request.headers.authorization ?? '';
    let body = ''; for await (const chunk of request) body += chunk; payload = JSON.parse(body);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const content of ['Local ', 'response']) response.write(`data: ${JSON.stringify({ id: 'local-test', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: 'local-test', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`); response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const provider = configuredProvider({ provider: 'openai-compatible', model: 'test-model', baseUrl: `http://127.0.0.1:${port}/v1` }, 'not-a-real-api-key');
    const chunks: string[] = [];
    let text = '';
    for await (const event of provider.stream({ messages: [{ role: 'user', text: 'local-only' }], tools: [] }, { signal: new AbortController().signal })) { if (event.type === 'text_delta') chunks.push(event.delta); if (event.type === 'finish') text = event.message.text; }
    expect(text).toBe('Local response'); expect(chunks.join('')).toBe(text);
    expect(payload.model).toBe('test-model'); expect(authorization).toBe('Bearer not-a-real-api-key');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
