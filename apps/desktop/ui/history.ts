import type { RunEvent } from '@wisp/core';
import { groupExecution } from './tool-groups.js';

/** Snapshot order wins; retain notices delivered while that snapshot was in flight. */
export function mergeHistory(previous: RunEvent[], incoming: RunEvent[]): RunEvent[] {
  const merged = new Map(incoming.map(event => [event.id, event]));
  const incomingIds = new Set(merged.keys());
  for (const event of previous) if (!incomingIds.has(event.id)) merged.set(event.id, event);
  return [...merged.values()];
}

export function indexSessions(events: RunEvent[]) {
  const sessions = new Map<string | undefined, RunEvent[]>();
  for (const event of events) {
    let session = sessions.get(event.sessionId);
    if (!session) sessions.set(event.sessionId, session = []);
    session.push(event);
  }
  return sessions;
}

/** Group each run once, preserving first-seen top-level turn and event order. */
export function historyTurns(events: RunEvent[]) {
  const grouped = new Map<string, RunEvent[]>(), children = new Map<string, RunEvent[]>(), roots = new Set<string>();
  for (const event of events) {
    let run = grouped.get(event.runId);
    if (!run) grouped.set(event.runId, run = []);
    run.push(event);
    if (!event.parentRunId) roots.add(event.runId);
    else {
      let child = children.get(event.parentRunId);
      if (!child) children.set(event.parentRunId, child = []);
      child.push(event);
    }
  }
  return [...roots].map(runId => {
    const run = grouped.get(runId)!;
    const resolved = new Set(run.filter(e => e.type === 'approval_resolved').map(e => e.data.callId));
    return {
      runId, run, children: children.get(runId) ?? [],
      start: run.find(e => e.type === 'started'),
      terminal: run.findLast(e => ['completed', 'failed', 'cancelled'].includes(e.type)),
      steps: [...new Set(run.filter(e => e.type === 'assistant' || e.type === 'assistant_delta').map(e => Number(e.data.step ?? 0)))],
      answers: groupExecution(run).answers,
      pending: run.filter(e => e.type === 'approval_requested' && !resolved.has(e.data.id)),
    };
  });
}
