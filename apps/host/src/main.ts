import { parentDesktopService } from './desktop-service.js';
import { parentCredentialVault } from './credential-ipc.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Runtime } from './runtime.js';
import { serveWorkbench } from './http.js';
const web = process.argv[2] === '--web';
const directory = web ? resolve(process.env.WISP_DATA_DIR ?? '.wisp') : process.argv[2];
if (!directory || (!web && !process.send)) throw new Error('Host requires local IPC or --web mode');
const runtime = new Runtime(directory, undefined, !web && process.argv[3] === '--secure-credentials' ? parentCredentialVault() : undefined, undefined, !web ? parentDesktopService() : undefined);
const initialized = runtime.init();
if (web) {
  await initialized;
  const token = randomBytes(32).toString('hex');
  const host = await serveWorkbench(runtime, fileURLToPath(new URL('../../desktop/web-preview-dist', import.meta.url)), token, Number(process.env.WISP_PORT ?? 5180));
  // One-time pairing URL stays in the local terminal. Fragment is not sent in HTTP requests.
  process.stdout.write(`Wisp 本机工作台（仅本机可访问）：${host.origin}/#connect=${token}\n`);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { void runtime.shutdown().then(() => host.close()).finally(() => process.exit(0)); });
} else {
  runtime.subscribe(notice => { if (process.connected) process.send?.({ type: 'notice', notice }); });
  process.on('message', async input => {
    if ((input as { type?: string })?.type === 'credential-response' || (input as {type?:string})?.type === 'desktop-response') return;
    const envelope = input as { id?: string; request?: unknown };
    if (typeof envelope.id !== 'string') return;
    try { await initialized; const result = await runtime.request(envelope.request); if (process.connected) process.send?.({ type: 'response', id: envelope.id, result }); }
    catch (error) { if (process.connected) process.send?.({ type: 'response', id: envelope.id, error: error instanceof Error ? error.message : 'Host error' }); }
  });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { void runtime.shutdown().finally(() => process.exit(0)); });
  process.on('disconnect', () => { void runtime.shutdown().finally(() => process.exit(0)); });
  await initialized;
  process.send?.({ type: 'host-ready' });
}
