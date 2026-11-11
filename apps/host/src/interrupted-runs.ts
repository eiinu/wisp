import type { RunEvent } from '@wisp/core';
/** Inspect persisted terminal records once; recovery must never replay a tool. */
export function interruptedStarts(events: RunEvent[]) {
  const terminal = new Set(events.filter(e => ['completed', 'cancelled', 'failed'].includes(e.type)).map(e => e.runId));
  return events.filter(e => e.type === 'started' && !terminal.has(e.runId));
}
