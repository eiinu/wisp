import { access, readFile, mkdtemp, rm, readdir, realpath } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { fork, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = resolve(process.argv[2] ?? 'release/linux-unpacked/resources/app');
const executable = resolve(process.argv[3] ?? process.execPath);
const expectedArch = process.argv[4] ?? process.arch;
const childEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
assert.equal(execFileSync(executable, ['-p', 'process.arch'], { env: childEnv, encoding: 'utf8' }).trim(), expectedArch);
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
assert.equal(metadata.main, 'apps/desktop/dist/main.js');
for (const file of [metadata.main, 'apps/desktop/dist/preload.cjs', 'apps/desktop/ui-dist/index.html', 'apps/host/dist/main.js']) await access(join(root, file));
const html = await readFile(join(root, 'apps/desktop/ui-dist/index.html'), 'utf8');
const assets = [...html.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g)];
assert(assets.length >= 2, 'Renderer must reference packaged JS and CSS assets');
for (const [, asset] of assets) await access(join(root, 'apps/desktop/ui-dist', asset));
assert(!html.includes('localhost:5173'));
// Every symlink must remain inside the portable app; no workspace/store references.
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isSymbolicLink()) { const target = relative(root, await realpath(file)); assert(!target.startsWith('..') && !isAbsolute(target), `External package link: ${file}`); }
    else if (entry.isDirectory()) await inspect(file);
  }
}
await inspect(root);
const require = createRequire(join(root, 'package.json'));
for (const specifier of ['@earendil-works/pi-ai', '@earendil-works/pi-ai/api/openai-completions.lazy', '@modelcontextprotocol/sdk/client/index.js', '@playwright/mcp/package.json']) {
  const resolved = execFileSync(executable, ['--input-type=module', '-e', `console.log(import.meta.resolve(${JSON.stringify(specifier)}))`], { cwd: root, env: childEnv, encoding: 'utf8' }).trim();
  const file = fileURLToPath(resolved); await access(file); assert(!relative(root, file).startsWith('..'), `Dependency escaped package: ${specifier}`);
}
const data = await mkdtemp(join(tmpdir(), 'wisp-package-check-'));
const host = fork(join(root, 'apps/host/dist/main.js'), [data], { execPath: executable, env: childEnv, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
let stderr = ''; host.stderr.on('data', chunk => { stderr += chunk; });
const pending = new Map(); let sequence = 0;
const ready = new Promise((resolveReady, reject) => {
  const timer = setTimeout(() => reject(new Error('Packaged Host startup timed out')), 15000);
  host.on('message', message => { if (message.type === 'host-ready') { clearTimeout(timer); resolveReady(); } if (message.type === 'response') { const call = pending.get(message.id); if (call) { pending.delete(message.id); clearTimeout(call.timer); message.error ? call.reject(new Error(message.error)) : call.resolve(message.result); } } });
  host.once('error', error => { clearTimeout(timer); reject(error); });
  host.once('exit', code => { clearTimeout(timer); reject(new Error(`Packaged Host exited ${code}: ${stderr}`)); });
});
function request(request) { return new Promise((resolveCall, reject) => { const id = String(++sequence); const timer = setTimeout(() => { pending.delete(id); reject(new Error('Host IPC timeout')); }, 10000); pending.set(id, { resolve: resolveCall, reject, timer }); host.send({ id, request }); }); }
let client;
try {
  await ready;
  await request({ type: 'model.save', config: { provider: 'offline', model: 'offline-test', baseUrl: '' } });
  const { sessionId } = await request({ type: 'session.create', title: 'Package verification' });
  await request({ type: 'run.start', sessionId, prompt: 'package check', maxSteps: 2 });
  let completed = false;
  for (let attempt = 0; attempt < 100; attempt++) { const { snapshot } = await request({ type: 'snapshot' }); if (snapshot.events.some(e => e.type === 'completed')) { completed = true; break; } await new Promise(resolveDelay => setTimeout(resolveDelay, 50)); }
  assert(completed, 'Packaged offline Agent did not complete');
  const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
  const { StdioClientTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
  const cli = join(require.resolve('@playwright/mcp/package.json'), '..', 'cli.js');
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TEMP', 'SYSTEMROOT'].filter(key => process.env[key]).map(key => [key, process.env[key]])); env.ELECTRON_RUN_AS_NODE = '1';
  client = new Client({ name: 'wisp-package-check', version: metadata.version });
  await client.connect(new StdioClientTransport({ command: executable, args: [cli, '--browser', 'chromium', '--sandbox', '--isolated'], env, stderr: 'pipe' }), { timeout: 10000 });
  const tools = await client.listTools({}, { timeout: 10000 }); assert(tools.tools.some(tool => tool.name === 'browser_navigate'));
  console.log(JSON.stringify({ version: metadata.version, architecture: expectedArch, host: 'IPC + offline Agent passed', mcp: 'handshake + discovery passed; browser not launched', renderer: 'assets present; GUI not exercised' }));
} finally {
  await client?.close();
  if (host.exitCode === null) { const exited = new Promise(resolveExit => host.once('exit', resolveExit)); host.kill(); await exited; }
  await rm(data, { recursive: true, force: true });
}
