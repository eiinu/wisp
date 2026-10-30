import { createServer, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Runtime } from './runtime.js';
export async function serveWorkbench(runtime: Runtime, assets: string, token: string, port = 5180) {
  const streams = new Set<ServerResponse>();
  const server = createServer(async (request, response) => {
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    const json = (status: number, value: unknown) => { response.writeHead(status, { ...headers, 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.headers.host !== new URL(origin).host || !['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')) { json(403, { error: 'Invalid host' }); return; }
    if (request.url?.startsWith('/api/')) {
      const supplied = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      if (request.headers.origin !== origin || Buffer.byteLength(supplied) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) { json(403, { error: '连接未授权，请使用 Host 提供的本机连接链接' }); return; }
      if (request.method !== 'POST') { json(405, { error: 'POST required' }); return; }
      if (request.url === '/api/events') {
        response.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' }); response.write(': connected\n\n'); streams.add(response);
        const unsubscribe = runtime.subscribe(notice => response.write(`data: ${JSON.stringify(notice)}\n\n`));
        const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15000);
        response.on('close', () => { clearInterval(heartbeat); unsubscribe(); streams.delete(response); }); return;
      }
      if (request.url !== '/api/request' || request.headers['content-type'] !== 'application/json') { json(400, { error: 'Invalid request' }); return; }
      try {
        let body = ''; for await (const chunk of request) { body += chunk.toString(); if (Buffer.byteLength(body) > 350000) { json(413, { error: '请求过大' }); return; } }
        const result = await runtime.request(JSON.parse(body)); json(200, result);
      } catch (error) { json(400, { error: error instanceof Error ? error.message : 'Host 请求失败' }); }
      return;
    }
    if (request.method !== 'GET' || !(request.url === '/' || request.url === '/index.html' || /^\/assets\/[\w.-]+$/.test(request.url ?? ''))) { json(404, { error: 'Not found' }); return; }
    const path = request.url === '/' ? 'index.html' : request.url!.slice(1);
    try {
      const content = await readFile(join(assets, path));
      response.writeHead(200, { ...headers, 'Content-Type': path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' }); response.end(content);
    } catch { json(404, { error: '请先构建 Web 工作台' }); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  return { server, origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: async () => { streams.forEach(stream => stream.end()); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
