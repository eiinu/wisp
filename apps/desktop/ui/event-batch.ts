import type { RunEvent, Snapshot } from '@wisp/core';

/** One immutable update per synchronous notice burst, without changing delivery order. */
export function applyEventBatch(snapshot: Snapshot, batch: RunEvent[]): Snapshot {
  if (!batch.length) return snapshot;
  const ids = new Set(snapshot.events.map(event => event.id)), added: RunEvent[] = [];
  const latest = new Map<string | undefined, RunEvent>(), started = new Map<string | undefined, string>();
  for (const event of batch) {
    if (!ids.has(event.id)) { ids.add(event.id); added.push(event); }
    latest.set(event.sessionId, event);
    if (event.type === 'started' && !event.parentRunId) started.set(event.sessionId, event.runId);
  }
  return {...snapshot, events:added.length ? [...snapshot.events, ...added] : snapshot.events,
    sessions:snapshot.sessions.map(session => {
      const event = latest.get(session.id);
      return event ? {...session, updatedAt:event.at, activeRunId:started.get(session.id) ?? session.activeRunId} : session;
    })};
}

export function batchEventNotices(deliver: (events: RunEvent[]) => void) {
  let pending: RunEvent[] = [], scheduled = false, live = true;
  return {
    push(event: RunEvent) {
      if (!live) return;
      pending.push(event);
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        const batch = pending; pending = [];
        if (live) deliver(batch);
      });
    },
    dispose() { live = false; pending = []; },
  };
}
