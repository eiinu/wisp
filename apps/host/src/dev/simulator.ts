import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
export const simulationModel = 'wisp-dev-simulator';
/** Explicit development fixture. No inference, external traffic, or tool execution here. */
export async function startSimulator(key: string, port = 0, tickMs = 40) {
  const failures = new Set<string>();
  const stats = { requests: 0, retries: 0, cancelled: 0 };
  const server = createServer(async (request, response) => {
    const supplied = request.headers.authorization ?? '', expected = `Bearer ${key}`;
    const origin = `127.0.0.1:${(server.address() as { port: number }).port}`;
    const json = (status: number, data: unknown) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(data)); };
    if (request.headers.host !== origin || request.headers.origin || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) { json(403, { error: { code: 'fixture_auth' } }); return; }
    if (request.url === '/models' && request.method === 'GET') { json(200, { data: [{ id: simulationModel, name: '开发模拟 · 非真实模型', effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' } }] }); return; }
    if (request.url !== '/chat/completions' || request.method !== 'POST') { json(404, {}); return; }
    const controller = new AbortController(); response.on('close', () => { if (!response.writableEnded) stats.cancelled++; controller.abort(); });
    try {
      let body = ''; for await (const chunk of request) { body += chunk.toString(); if (Buffer.byteLength(body) > 1024 * 1024) { json(413, {}); return; } }
      const input = JSON.parse(body); if (input.model !== simulationModel || !Array.isArray(input.messages)) { json(400, { error: { code: 'fixture_model_required' } }); return; }
      stats.requests++;
      const userIndex = input.messages.findLastIndex((m: any) => m.role === 'user'), current = input.messages.slice(userIndex), prompt = String(current[0]?.content ?? '');
      const scenario = /\[demo:(chat|write|deny|cancel|retry|error|read)\]/.exec(prompt)?.[1] ?? 'chat';
      const result = current.findLast((m: any) => m.role === 'tool');
      const failureKey = `${scenario}:${prompt}:${current.length}`;
      if (((scenario === 'retry' && result) || scenario === 'error') && !failures.has(failureKey)) { failures.add(failureKey); stats.retries++; json(scenario === 'error' ? 400 : 503, { error: { code: 'development_injected_error' } }); return; }
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }); response.write(': development simulator\n\n');
      const frame = (delta: object, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }], ...(finish_reason ? { usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18, completion_tokens_details: { reasoning_tokens: 3 } } } : {}) })}\n\n`);
      for (const chunk of ['开发模拟推理：', '检查当前测试场景。']) { frame({ reasoning_content: chunk }); await delay(tickMs, undefined, { signal: controller.signal }); }
      if (!result && ['write', 'deny', 'retry', 'read'].includes(scenario)) {
        const read = scenario === 'read', args = read ? { path: 'README.md' } : { path: `${scenario}.txt`, content: `开发模拟已批准写入：${scenario}\n` };
        frame({ content: '开发模拟：通过真实 Host 请求工具；写入需要你批准。' });
        const encoded = JSON.stringify(args), split = Math.floor(encoded.length / 2);
        frame({ tool_calls: [{ index: 0, id: randomUUID(), type: 'function', function: { name: read ? 'files_read' : 'files_write', arguments: encoded.slice(0, split) } }] });
        await delay(tickMs, undefined, { signal: controller.signal }); frame({ tool_calls: [{ index: 0, function: { arguments: encoded.slice(split) } }] }); frame({}, 'tool_calls');
      } else {
        const text = scenario === 'cancel' ? '开发模拟慢速输出，请点击停止。'.repeat(50) : result ? `开发模拟：Host 的实际工具结果：${result.content}` : '开发模拟回复：这是脚本化协议夹具，不是真实 DeepSeek 推理。可以发送 [demo:write]、[demo:deny]、[demo:cancel]、[demo:retry]、[demo:error] 或 [demo:read] 验证交互。';
        for (const chunk of text.match(/.{1,8}/gs) ?? []) { frame({ content: chunk }); await delay(tickMs, undefined, { signal: controller.signal }); }
        frame({}, 'stop');
      }
      response.end('data: [DONE]\n\n');
    } catch { if (!response.headersSent) json(400, { error: { code: 'invalid_fixture_request' } }); else response.end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  return { origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, stats, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
