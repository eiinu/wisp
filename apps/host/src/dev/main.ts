import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Runtime } from '../runtime.js';
import { serveWorkbench } from '../http.js';
import { startSimulator } from './simulator.js';
const existing = process.argv[2];
const directory = existing ? resolve(existing) : await mkdtemp(join(tmpdir(), 'wisp-development-'));
let modelPort = 0;
if (existing) { const marker = JSON.parse(await readFile(join(directory, 'simulation.json'), 'utf8')); if (marker.kind !== 'wisp-development' || !Number.isInteger(marker.modelPort)) throw new Error('Only a previously created Wisp simulation directory can be resumed'); modelPort = marker.modelPort; }
const key = randomBytes(32).toString('hex'), token = randomBytes(32).toString('hex');
const simulator = await startSimulator(key, modelPort);
await writeFile(join(directory, 'simulation.json'), JSON.stringify({ kind: 'wisp-development', modelPort: Number(new URL(simulator.origin).port) }), { mode: 0o600 });
const runtime = new Runtime(join(directory, 'host'), undefined, undefined, { baseUrl: simulator.origin, key }); await runtime.init();
if (!existing) {
  const workspace = join(directory, 'workspace'); await mkdir(workspace, { mode: 0o700 });
  await writeFile(join(workspace, 'README.md'), '# Wisp 开发模拟\n这是临时工作目录。模型是脚本夹具，Host 文件工具是真实执行。\n', { mode: 0o600 });
  const sessionId = (await runtime.request({ type: 'session.create', title: '开发模拟 · 本机工具验证' })).sessionId!;
  await runtime.request({ type: 'workspace.grant', sessionId, path: workspace, confirmed: true });
}
const host = await serveWorkbench(runtime, fileURLToPath(new URL('../../desktop/web-preview-dist', import.meta.url)), token, Number(process.env.WISP_DEV_PORT ?? 5190));
process.stdout.write(`Wisp 开发模拟（脚本模型，真实 Host 工具，仅本机）\n数据目录：${directory}\n模型服务：${simulator.origin}\n工作台：${host.origin}/#connect=${token}\n发送 [demo:chat/write/deny/cancel/retry/error/read] 中的单个场景，例如 [demo:write]。\n`);
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { void runtime.shutdown().then(() => Promise.all([host.close(), simulator.close()])).finally(() => process.exit(0)); });
