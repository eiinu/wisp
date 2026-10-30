import { it, expect } from 'vitest';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Runtime } from '../apps/host/src/runtime.js';
import { serveWorkbench } from '../apps/host/src/http.js';
it('requires loopback, correct Host, Origin and bearer token for Host requests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wisp-http-')), runtime = new Runtime(join(root, 'data')); await runtime.init();
  await writeFile(join(root, 'index.html'), '<title>Wisp</title>'); const token = 'a'.repeat(64), host = await serveWorkbench(runtime, root, token, 0);
  try {
    const request = (headers: Record<string, string>) => fetch(host.origin + '/api/request', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ type: 'snapshot' }) });
    expect((await request({})).status).toBe(403);
    expect((await request({ Origin: 'https://evil.example', Authorization: `Bearer ${token}` })).status).toBe(403);
    expect((await request({ Origin: host.origin, Authorization: 'Bearer wrong' })).status).toBe(403);
    const badHost = await new Promise<number | undefined>((resolve, reject) => { const req = httpRequest(host.origin + '/api/request', { method: 'POST', headers: { Host: 'evil.example', Origin: host.origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end('{}'); });
    expect(badHost).toBe(403);
    const valid = await request({ Origin: host.origin, Authorization: `Bearer ${token}` }); expect(valid.status).toBe(200); expect((await valid.json()).snapshot.keyPresent).toBe(false);
    expect((await fetch(host.origin + '/')).status).toBe(200);
    expect((await fetch(host.origin + '/state.json')).status).toBe(404);
    const controller = new AbortController();
    const events = await fetch(host.origin + '/api/events', { method: 'POST', headers: { Origin: host.origin, Authorization: `Bearer ${token}` }, signal: controller.signal });
    expect(events.headers.get('content-type')).toBe('text/event-stream');
    const reader = events.body!.getReader(); await reader.read();
    await runtime.request({ type: 'session.create', title: 'Event delivery' });
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('changed'); controller.abort();
  } finally { await host.close(); await rm(root, { recursive: true, force: true }); }
});
