import type { RunEvent } from '@wisp/core';

/** First result wins, matching the historical find() behavior for replayed records. */
export function indexToolRound(events: RunEvent[]) {
  const results = new Map<unknown, RunEvent>();
  const started = new Set<unknown>(), approvals = new Set<unknown>(), allowed = new Set<unknown>();
  const questions = new Set<unknown>(), answered = new Set<unknown>();
  for (const event of events) {
    const id = event.data.callId;
    if (event.type === 'tool_result' && !results.has(id)) results.set(id, event);
    if (event.type === 'tool_started') started.add(id);
    if (event.type === 'approval_requested') approvals.add(event.data.id);
    if (event.type === 'approval_resolved' && event.data.allowed) allowed.add(id);
    if (event.type === 'question_requested') questions.add(id);
    if (event.type === 'question_resolved') answered.add(id);
  }
  return { results, started, approvals, allowed, questions, answered };
}
