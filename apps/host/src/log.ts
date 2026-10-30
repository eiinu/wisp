import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { eventSchema, type RunEvent } from '@wisp/core';
export class EventLog {
  private queue: Promise<void> = Promise.resolve();
  constructor(readonly path: string) {}
  append(event: RunEvent) {
    const next = this.queue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await appendFile(this.path, JSON.stringify(eventSchema.parse(event)) + '\n', { mode: 0o600 });
    });
    this.queue = next;
    return next;
  }
  async read(): Promise<RunEvent[]> {
    await this.queue;
    let text: string;
    try { text = await readFile(this.path, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
    return text.split('\n').filter(Boolean).map((line, i) => {
      try { return eventSchema.parse(JSON.parse(line)); } catch { throw new Error(`Invalid event log at line ${i + 1}; preserve the file for recovery`); }
    });
  }
}
