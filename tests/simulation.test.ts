import { it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Runtime } from '../apps/host/src/runtime.js';
import { serveWorkbench } from '../apps/host/src/http.js';
import { startSimulator } from '../apps/host/src/dev/simulator.js';
import type { Request, Result, Snapshot } from '../packages/core/src/index.js';
it('validates the shared Web HTTP boundary with simulator, approvals, cancellation, retry, switching and restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wisp-simulation-test-')), workspace = join(root, 'workspace'); await mkdir(workspace); await writeFile(join(workspace, 'README.md'), 'fixture real file');
  const simulator = await startSimulator('fake-simulator-key', 0, 1); const development = { baseUrl: simulator.origin, key: 'fake-simulator-key' };
  let runtime = new Runtime(join(root, 'host'), undefined, undefined, development); await runtime.init();
  let host = await serveWorkbench(runtime, resolve('apps/desktop/web-preview-dist'), 'fake-web-token', 0);
  const api = async (command: Request): Promise<Result> => { const response = await fetch(`${host.origin}/api/request`, { method: 'POST', headers: { origin: host.origin, authorization: 'Bearer fake-web-token', 'content-type': 'application/json' }, body: JSON.stringify(command) }); const value = await response.json(); if (!response.ok) throw new Error(value.error); return value; };
  const snapshot = async () => (await api({ type: 'snapshot' })).snapshot!;
  const wait = async (check: (s: Snapshot) => boolean) => { await vi.waitFor(async () => expect(check(await snapshot())).toBe(true), { timeout: 5000 }); };
  try {
    await expect(api({ type: 'model.save', config: { provider: 'deepseek', model: 'wisp-dev-simulator', baseUrl: simulator.origin }, apiKey: 'pretend-user-key' })).rejects.toThrow('不接受真实');
    const first = (await api({ type: 'session.create', title: 'simulation A' })).sessionId!, second = (await api({ type: 'session.create', title: 'simulation B' })).sessionId!;
    await api({ type: 'workspace.grant', sessionId: first, path: workspace, confirmed: true });
    const run = async (scenario: string) => { await api({ type: 'run.start', sessionId: first, prompt: `[demo:${scenario}]`, maxSteps: 4 }); await wait(s => s.events.some(e => e.sessionId === first && e.type === 'started' && e.data.prompt === `[demo:${scenario}]`)); return (await snapshot()).events.findLast(e => e.type === 'started')!.runId; };
    const finish = async (id: string, type = 'completed') => wait(s => s.events.some(e => e.runId === id && e.type === type) && !s.sessions.some(session => session.activeRunId === id));
    const chat = await run('chat'); await finish(chat); expect((await snapshot()).events.some(e => e.runId === chat && e.type === 'model_activity')).toBe(true); expect((await snapshot()).events.filter(e => e.runId === chat && e.type === 'assistant_delta').length).toBeGreaterThan(1);
    for (const scenario of ['write', 'deny', 'retry']) {
      const id = await run(scenario); await wait(s => s.events.some(e => e.runId === id && e.type === 'approval_requested'));
      await expect(readFile(join(workspace, `${scenario}.txt`))).rejects.toThrow();
      await api({ type: 'session.select', sessionId: second }); const approval = (await snapshot()).events.find(e => e.runId === id && e.type === 'approval_requested')!;
      await expect(api({ type: 'run.approve', sessionId: second, runId: id, callId: String(approval.data.id), allowed: true })).rejects.toThrow('匹配');
      await api({ type: 'session.select', sessionId: first }); await api({ type: 'run.approve', sessionId: first, runId: id, callId: String(approval.data.id), allowed: scenario !== 'deny' }); await finish(id);
      if (scenario === 'deny') await expect(readFile(join(workspace, 'deny.txt'))).rejects.toThrow(); else expect(await readFile(join(workspace, `${scenario}.txt`), 'utf8')).toContain(scenario);
      expect((await snapshot()).events.filter(e => e.runId === id && e.type === 'tool_requested')).toHaveLength(1);
    }
    expect(simulator.stats.retries).toBe(1);
    const error = await run('error'); await finish(error, 'failed'); await api({ type: 'run.retry', sessionId: first }); await wait(s => s.events.findLast(e => e.type === 'started')?.runId !== error); const retried = (await snapshot()).events.findLast(e => e.type === 'started')!.runId; await finish(retried);
    const cancelled = await run('cancel'); await wait(s => s.events.some(e => e.runId === cancelled && e.type === 'assistant_delta')); await api({ type: 'run.cancel', sessionId: first, runId: cancelled }); await finish(cancelled, 'cancelled'); await vi.waitFor(() => expect(simulator.stats.cancelled).toBeGreaterThan(0));
    await api({ type: 'session.select', sessionId: second }); await host.close(); await runtime.shutdown(); runtime = new Runtime(join(root, 'host'), undefined, undefined, development); await runtime.init(); host = await serveWorkbench(runtime, resolve('apps/desktop/web-preview-dist'), 'fake-web-token', 0);
    expect((await snapshot()).selectedId).toBe(second); expect((await snapshot()).events.filter(e => e.sessionId === second)).toHaveLength(0);
    await api({ type: 'session.select', sessionId: first }); const read = await run('read'); await finish(read); expect((await snapshot()).events.some(e => e.runId === read && e.type === 'tool_result' && e.data.text === 'fixture real file')).toBe(true);
    expect(JSON.stringify(await snapshot())).not.toContain('开发模拟推理');
  } finally { await host.close(); await runtime.shutdown(); await simulator.close(); await rm(root, { recursive: true, force: true }); }
});
