import { it, expect } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import type { Request, Result } from '../packages/core/src/index.js';
function launch(directory: string) { return fork(resolve('apps/host/dist/main.js'), [directory], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }); }
function call(child: ChildProcess, request: Request): Promise<Result> {
  const id = randomUUID(); return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.off('message', receive); reject(new Error('IPC timeout')); }, 5000);
    const receive = (message: any) => { if (message.id === id) { clearTimeout(timeout); child.off('message', receive); message.error ? reject(new Error(message.error)) : resolve(message.result); } };
    child.on('message', receive); child.send({ id, request });
  });
}
async function stop(child: ChildProcess) { if (child.exitCode !== null || child.signalCode !== null) return; await new Promise<void>(done => { child.once('exit', () => done()); child.kill(); }); }
it('built Host restores interrupted sessions over IPC without replaying approvals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wisp-ipc-')), directory = join(root, 'data'), work = join(root, 'work'); await mkdir(work);
  let child = launch(directory);
  try {
    const id = (await call(child, { type: 'session.create', title: 'Persisted session' })).sessionId!;
    await call(child, { type: 'workspace.grant', sessionId: id, path: work, confirmed: true });
    const pending = new Promise<any>((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('approval timeout')), 5000); child.on('message', (m: any) => { if (m.type === 'notice' && m.notice.event?.type === 'approval_requested') { clearTimeout(timeout); resolve(m.notice.event); } }); });
    await call(child, { type: 'files.write', sessionId: id, path: 'note.txt', content: 'should not execute' }); const approval = await pending;
    await stop(child); child = launch(directory);
    const snapshot = (await call(child, { type: 'snapshot' })).snapshot!;
    expect(snapshot.sessions[0].title).toBe('Persisted session'); expect(snapshot.events.at(-1)?.type).toBe('failed'); expect(snapshot.events.at(-1)?.data.reason).toContain('重启');
    expect(snapshot.events.some(e => e.type === 'tool_result')).toBe(false);
    await expect(call(child, { type: 'run.approve', sessionId: id, runId: approval.runId, callId: approval.data.id, allowed: true })).rejects.toThrow('匹配');
  } finally { await stop(child); await rm(root, { recursive: true, force: true }); }
}, 15000);
