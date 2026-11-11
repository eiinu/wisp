import { expect, it } from 'vitest';
import type { RunEvent } from '@wisp/core';
import { historyTurns, indexSessions, mergeHistory } from './history.js';
const event = (id: string, extra: Partial<RunEvent> = {}): RunEvent => ({version:1,id,sessionId:'s',runId:'r',at:'',type:'assistant_delta',data:{text:id},...extra});
it('preserves snapshot order and values, deduplicates replay, and retains in-flight streamed events', () => {
 const old=event('a'), fresh=event('a',{data:{text:'snapshot wins'}}), stream=event('c');
 expect(mergeHistory([old,event('b'),stream,stream],[event('b'),old,fresh])).toEqual([event('b'),fresh,stream]);
 expect(mergeHistory([stream],[])).toEqual([stream]);
});
it('reads event IDs linearly on a 25k history instead of scanning each previous ID against every incoming ID', () => {
 let reads=0;
 const events=Array.from({length:25000},(_,i)=>({...event(String(i)),get id(){reads++;return String(i);}}));
 expect(mergeHistory(events,events)).toHaveLength(25000);
 expect(reads).toBeLessThanOrEqual(events.length*3);
});
it('indexes sessions, top-level turns, child runs and approvals without changing event or round order', () => {
 const input=[event('foreign',{sessionId:'other'}),event('start',{type:'started'}),event('child',{runId:'child',parentRunId:'r'}),event('delta',{data:{step:0,text:'draft'}}),event('approval',{type:'approval_requested',data:{id:'call'}}),event('resolved',{type:'approval_resolved',data:{callId:'call'}}),event('pending',{type:'approval_requested',data:{id:'other'}}),event('final',{type:'assistant',data:{step:0,text:'final'}}),event('done',{type:'completed'}),event('second',{runId:'second',type:'started'})];
 const session=indexSessions(input).get('s')!;
 const turns=historyTurns(session);
 expect(turns.map(t=>t.runId)).toEqual(['r','second']);
 expect(turns[0].run).toEqual(session.filter(e=>e.runId==='r'));
 expect(turns[0].children).toEqual([input[2]]);
 expect(turns[0].answers.map(a=>a.text)).toEqual(['final']);
 expect(turns[0].pending.map(e=>e.id)).toEqual(['pending']);
 expect(turns[0].terminal?.id).toBe('done');
 expect(turns[0].steps).toEqual([0]);
});
