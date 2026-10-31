import { it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, link } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Runtime } from '../apps/host/src/runtime.js';
import { WorkspaceFiles } from '../apps/host/src/files.js';
import type { RunEvent } from '../packages/core/src/index.js';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'wisp-runtime-')), directory = join(root, 'private'), work = join(root, 'work'); await mkdir(work);
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const runtime = new Runtime(directory); await runtime.init();
  await runtime.request({ type: 'model.save', config: { provider: 'offline', model: 'offline-test', baseUrl: '' } });
  const id = (await runtime.request({ type: 'session.create', title: 'A' })).sessionId!;
  await runtime.request({ type: 'workspace.grant', sessionId: id, path: work, confirmed: true });
  return { root, directory, work, runtime, id };
}
async function event(runtime: Runtime, id: string, type: RunEvent['type']) {
  await vi.waitFor(() => expect(runtime.snapshot().events.some(e => e.sessionId === id && e.type === type)).toBe(true));
  return runtime.snapshot().events.findLast(e => e.sessionId === id && e.type === type)!;
}
async function idle(runtime: Runtime, id: string) { await event(runtime, id, 'completed'); await vi.waitFor(() => expect(runtime.snapshot().sessions.find(s => s.id === id)?.activeRunId).toBeUndefined()); await new Promise(r => setTimeout(r, 30)); }
it('isolates sessions, enforces write approval, persists files/history and selection', async () => {
  const { runtime, id, work, directory } = await setup();
  const other = (await runtime.request({ type: 'session.create', title: 'B' })).sessionId!;
  await runtime.request({ type: 'files.write', sessionId: id, path: 'note.md', content: '# Real file' });
  const pending = await event(runtime, id, 'approval_requested');
  await expect(readFile(join(work, 'note.md'))).rejects.toThrow();
  await expect(runtime.request({ type: 'run.approve', sessionId: other, runId: pending.runId, callId: pending.data.id, allowed: true })).rejects.toThrow('匹配');
  await expect(runtime.request({ type: 'workspace.revoke', sessionId: id })).rejects.toThrow('执行');
  await runtime.request({ type: 'run.approve', sessionId: id, runId: pending.runId, callId: pending.data.id, allowed: true });
  await idle(runtime, id); expect(await readFile(join(work, 'note.md'), 'utf8')).toBe('# Real file');
  const preview = await runtime.request({ type: 'files.read', sessionId: id, path: 'note.md' }); expect(preview.file).toMatchObject({ kind: 'markdown', text: '# Real file' });
  await expect(runtime.request({ type: 'files.list', sessionId: other, path: '' })).rejects.toThrow('授权');
  expect(runtime.snapshot().events.filter(e => e.sessionId === other)).toHaveLength(0);
  await runtime.request({ type: 'session.select', sessionId: other });
  const restarted = new Runtime(directory); await restarted.init();
  expect(restarted.snapshot().selectedId).toBe(other); expect(restarted.snapshot().events).toEqual(runtime.snapshot().events);
  await expect(restarted.request({ type: 'run.approve', sessionId: id, runId: pending.runId, callId: pending.data.id, allowed: true })).rejects.toThrow();
});
it('denial and cancellation produce no write, and streamed content precedes completion', async () => {
  const { runtime, id, work } = await setup();
  await runtime.request({ type: 'run.start', sessionId: id, prompt: '写入 denied.txt\nnever', maxSteps: 3 });
  const pending = await event(runtime, id, 'approval_requested');
  await runtime.request({ type: 'run.approve', sessionId: id, runId: pending.runId, callId: pending.data.id, allowed: false }); await idle(runtime, id);
  expect(runtime.snapshot().events.some(e => e.type === 'assistant_delta')).toBe(true);
  await expect(readFile(join(work, 'denied.txt'))).rejects.toThrow();
  await runtime.request({ type: 'files.write', sessionId: id, path: 'cancelled.txt', content: 'never' });
  await vi.waitFor(() => expect(runtime.snapshot().events.filter(e => e.type === 'approval_requested')).toHaveLength(2));
  const second = runtime.snapshot().events.findLast(e => e.type === 'approval_requested')!;
  await runtime.request({ type: 'run.cancel', sessionId: id, runId: second.runId }); await event(runtime, id, 'cancelled');
  await expect(readFile(join(work, 'cancelled.txt'))).rejects.toThrow();
});
it('keeps model credentials in process memory and never returns or persists them', async () => {
  const { runtime, directory } = await setup(); const key = 'test-only-not-a-real-secret';
  await runtime.request({ type: 'model.save', config: { provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' }, apiKey: key });
  expect(runtime.snapshot().keyPresent).toBe(true); expect(JSON.stringify(runtime.snapshot())).not.toContain(key);
  expect(await readFile(join(directory, 'state.json'), 'utf8')).not.toContain(key);
  const restarted = new Runtime(directory); await restarted.init(); expect(restarted.snapshot().keyPresent).toBe(false);
  await runtime.request({ type: 'model.save', config: { provider: 'openai-compatible', model: 'test', baseUrl: 'https://other.example/v1' } });
  expect(runtime.snapshot().keyPresent).toBe(false);
  await expect(runtime.request({ type: 'model.save', config: { provider: 'deepseek', model: 'x', baseUrl: 'https://user:secret@example.com' } })).rejects.toThrow();
  await expect(runtime.request({ type: 'model.save', config: { provider: 'deepseek', model: 'x', baseUrl: 'https://example.com?api_key=secret' } })).rejects.toThrow();
});
it('blocks traversal, symbolic/hard links, hidden files, private data and oversized preview', async () => {
  const { root, work, directory } = await setup(); const files = await WorkspaceFiles.grant(work, directory);
  await writeFile(join(root, 'outside.txt'), 'outside'); await symlink(join(root, 'outside.txt'), join(work, 'escape.txt'));
  await symlink(root, join(work, 'escape-dir')); await link(join(root, 'outside.txt'), join(work, 'hard.txt'));
  for (const path of ['../outside.txt', '/etc/passwd', 'escape.txt', 'escape-dir/outside.txt', '.env', 'a/../../outside.txt', 'a\\..\\secret']) await expect(files.read(path)).rejects.toThrow();
  await expect(files.read('hard.txt')).rejects.toThrow();
  await expect(files.write('escape.txt', 'bad', new AbortController().signal)).rejects.toThrow();
  await expect(files.write('escape-dir/new.txt', 'bad', new AbortController().signal)).rejects.toThrow();
  await expect(files.write('hard.txt', 'bad', new AbortController().signal)).rejects.toThrow();
  expect(await readFile(join(root, 'outside.txt'), 'utf8')).toBe('outside');
  await writeFile(join(work, 'large.txt'), Buffer.alloc(2 * 1024 * 1024 + 1)); await expect(files.read('large.txt')).rejects.toThrow('2 MB');
  const broad = await WorkspaceFiles.grant(root, directory); await expect(broad.read('private/state.json')).rejects.toThrow('私有');
  expect((await files.list()).map(e => e.name)).not.toContain('escape.txt');
});
it('requires a configured model and does not silently fall back to mock', async () => {
  const { directory } = await setup(); const runtime = new Runtime(join(directory, 'fresh')); await runtime.init();
  const id = (await runtime.request({ type: 'session.create', title: 'new' })).sessionId!;
  await expect(runtime.request({ type: 'run.start', sessionId: id, prompt: 'hi', maxSteps: 2 })).rejects.toThrow('配置模型');
  expect(runtime.snapshot().events).toHaveLength(0);
});
it('feeds a file failure back to the model and accepts a corrected follow-up in the same session', async () => {
  const { runtime, id, work } = await setup();
  await runtime.request({ type: 'run.start', sessionId: id, prompt: '读取 missing.txt', maxSteps: 3 });
  await idle(runtime, id);
  expect(runtime.snapshot().events.some(e => e.type === 'tool_result' && e.data.isError)).toBe(true);
  await writeFile(join(work, 'missing.txt'), 'fixed');
  await runtime.request({ type: 'run.start', sessionId: id, prompt: '读取 missing.txt', maxSteps: 3 }); await idle(runtime, id);
  expect(runtime.snapshot().events.filter(e => e.type === 'started')).toHaveLength(2);
  expect(runtime.snapshot().events.some(e => e.type === 'tool_result' && e.data.text === 'fixed')).toBe(true);
});
it('runs two sessions independently and cancellation affects only its target', async () => {
  const { runtime, id } = await setup(); const other = (await runtime.request({ type: 'session.create', title: 'Other' })).sessionId!;
  await runtime.request({ type: 'files.write', sessionId: id, path: 'pending.txt', content: 'not yet' });
  const pending = await event(runtime, id, 'approval_requested');
  await runtime.request({ type: 'run.start', sessionId: other, prompt: 'hello', maxSteps: 3 });
  await runtime.request({ type: 'run.cancel', sessionId: id, runId: pending.runId });
  await event(runtime, id, 'cancelled'); await idle(runtime, other);
  expect(runtime.snapshot().events.filter(e => e.sessionId === other).at(-1)?.type).toBe('completed');
});

it('protects private data when its parent directory has a filesystem alias', async () => {
  const { root, directory } = await setup();
  const alias = join(root, 'parent-alias'); await symlink(root, alias, 'dir');
  const files = await WorkspaceFiles.grant(root, join(alias, 'private'));
  await expect(files.read('private/state.json')).rejects.toThrow('私有');
  expect((await files.list()).some(entry => entry.name === 'private')).toBe(false);
});

it('previews UTF-8 txt and Markdown, empty files and BOM-tagged UTF-16 without silent decoding corruption', async () => {
  const { work, directory } = await setup(); const files = await WorkspaceFiles.grant(work, directory);
  await writeFile(join(work, 'plain.txt'), '# literal <b>text</b>\r\n中文');
  expect(await files.read('plain.txt')).toMatchObject({ kind: 'text', text: '# literal <b>text</b>\r\n中文' });
  await writeFile(join(work, 'note.MD'), '\ufeff# 标题'); expect(await files.read('note.MD')).toMatchObject({ kind: 'markdown', text: '# 标题' });
  await writeFile(join(work, 'empty.txt'), ''); expect(await files.read('empty.txt')).toMatchObject({ kind: 'text', text: '', size: 0 });
  await writeFile(join(work, 'utf16.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('中文', 'utf16le')]));
  expect((await files.read('utf16.txt')).text).toBe('中文');
  await writeFile(join(work, 'bad.txt'), Buffer.from([0xc3, 0x28])); await expect(files.read('bad.txt')).rejects.toThrow('无法解码');
  await writeFile(join(work, 'binary.txt'), Buffer.from([0, 1, 2])); expect((await files.read('binary.txt')).kind).toBe('unsupported');
});
