import type { RunEvent } from '@wisp/core';
export interface ExecutionRound { step?: number; events: RunEvent[]; text: string }
/** Input is one scoped run. Deduplicate replayed events, never infer missing rounds by counting tools. */
export function groupExecution(input: RunEvent[]) {
  const first = input[0];
  const seen = new Set<string>(), calls = new Map<string, ExecutionRound>(), rounds = new Map<number | undefined, ExecutionRound>();
  let current: number | undefined;
  const round = (step?: number) => { let value = rounds.get(step); if (!value) { value = {step,events:[],text:''}; rounds.set(step,value); } return value; };
  for (const event of input) {
    if (event.runId !== first?.runId || event.sessionId !== first?.sessionId || seen.has(event.id)) continue;
    seen.add(event.id);
    const step = typeof event.data.step === 'number' && Number.isInteger(event.data.step) && event.data.step >= 0 ? event.data.step : undefined;
    if (event.type.startsWith('model_') || ['assistant','assistant_delta'].includes(event.type)) {
      if (step !== undefined) current = step;
      round(step).events.push(event);
    } else if (event.type === 'tool_requested') {
      const id = String(event.data.id); if (calls.has(id)) continue;
      const group = round(step ?? current); calls.set(id,group); group.events.push(event);
    } else if (['tool_started','tool_result','approval_requested','approval_resolved'].includes(event.type)) {
      const group = calls.get(String(event.data.callId ?? event.data.id));
      if (group) group.events.push(event);
    }
  }
  for (const group of rounds.values()) {
    const final = group.events.findLast(e=>e.type==='assistant');
    group.text = final ? String(final.data.text ?? '') : group.events.filter(e=>e.type==='assistant_delta').map(e=>String(e.data.text ?? '')).join('');
  }
  const ordered=[...rounds.values()];
  const process=ordered.filter(r=>r.events.some(e=>e.type==='tool_requested'));
  const answers=ordered.filter(r=>!process.includes(r)&&r.text);
  return {process,answers};
}
