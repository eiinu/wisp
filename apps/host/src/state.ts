import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectsSchema, modelConfigSchema, type ModelConfig, type SessionInfo } from '@wisp/core';
export type StoredProject = import('@wisp/core').StoredProject;
export interface State { projects: StoredProject[]; version: 1; sessions: SessionInfo[]; selectedId?: string; config?: ModelConfig }
export class StateStore {
  state: State = { version: 1, sessions: [], projects: [] };
  private queue = Promise.resolve();
  constructor(readonly directory: string) {}
  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const state = JSON.parse(await readFile(join(this.directory, 'state.json'), 'utf8')) as State;
      if (state.version !== 1 || !Array.isArray(state.sessions) || state.sessions.some(s => !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(s.id) || typeof s.title !== 'string' || (s.archivedAt !== undefined && typeof s.archivedAt !== 'string') || (s.workspace !== undefined && typeof s.workspace !== 'string'))) throw new Error('Unsupported state');
      state.projects = projectsSchema.parse(state.projects ?? []);
      if (new Set(state.projects.map(p => p.id)).size !== state.projects.length) throw new Error('Duplicate projects');
      for (const session of state.sessions) if (session.projectId !== undefined) {
        if (!state.projects.some(p => p.id === session.projectId)) throw new Error('Unknown project');
        delete session.workspace; // Project roots are derived, never a per-session override.
      }
      const selected = state.sessions.find(s => s.id === state.selectedId);
      if (selected?.archivedAt) state.selectedId = state.sessions.find(s => !s.archivedAt && s.projectId === selected.projectId)?.id;
      if (state.config) state.config = modelConfigSchema.parse(state.config);
      this.state = state; this.state.sessions.forEach(s => { delete s.activeRunId; });
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('会话状态损坏，请保留数据目录以便恢复'); }
  }
  save() {
    // Persist only explicit public metadata, never transient credentials or running state.
    const data = JSON.stringify({ ...this.state, sessions: this.state.sessions.map(({ activeRunId: _active, ...session }) => session) });
    this.queue = this.queue.then(async () => {
      const temp = join(this.directory, `state-${randomUUID()}.tmp`);
      await writeFile(temp, data, { mode: 0o600 }); await rename(temp, join(this.directory, 'state.json'));
    });
    return this.queue;
  }
}
