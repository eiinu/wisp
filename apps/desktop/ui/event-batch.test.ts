import { expect, it, vi } from 'vitest';
import type { RunEvent, Snapshot } from '@wisp/core';
import { applyEventBatch, batchEventNotices } from './event-batch.js';
const event=(id:string,extra:Partial<RunEvent>={}):RunEvent=>({version:1,id,at:id,sessionId:'one',runId:'run',type:'assistant_delta',data:{text:id},...extra});
const state:Snapshot={sessions:[{id:'one',title:'One',createdAt:'',updatedAt:''},{id:'two',title:'Two',createdAt:'',updatedAt:''}],events:[],keyPresent:false,browserConnected:false};
it('matches sequential notice semantics for duplicates, concurrent sessions and root/child starts',()=>{
 const batch=[event('start',{type:'started'}),event('child',{type:'started',runId:'child',parentRunId:'run'}),event('other',{type:'started',runId:'other',sessionId:'two'}),event('delta'),event('delta'),event('done',{type:'completed'})];
 const sequential=batch.reduce((s,e)=>({...s,events:s.events.some(old=>old.id===e.id)?s.events:[...s.events,e],sessions:s.sessions.map(session=>session.id!==e.sessionId?session:{...session,updatedAt:e.at,activeRunId:e.type==='started'&&!e.parentRunId?e.runId:session.activeRunId})}),state);
 expect(applyEventBatch(state,batch)).toEqual(sequential);
 expect(state.events).toHaveLength(0);
});
it('coalesces only synchronous bursts, preserves order, and discards work after disposal',async()=>{
 const deliver=vi.fn(),batch=batchEventNotices(deliver);
 batch.push(event('one'));batch.push(event('two'));expect(deliver).not.toHaveBeenCalled();
 await Promise.resolve();expect(deliver).toHaveBeenCalledExactlyOnceWith([event('one'),event('two')]);
 batch.push(event('three'));await Promise.resolve();expect(deliver).toHaveBeenLastCalledWith([event('three')]);
 batch.push(event('four'));batch.dispose();batch.push(event('five'));await Promise.resolve();expect(deliver).toHaveBeenCalledTimes(2);
});
it('scans large history once per burst and preserves its array when every notice is replayed',()=>{
 let reads=0;const events=Array.from({length:25000},(_,i)=>({...event(String(i)),get id(){reads++;return String(i);}}));
 const snapshot={...state,events};
 const result=applyEventBatch(snapshot,Array.from({length:1000},(_,i)=>event(`new-${i}`)));
 expect(reads).toBe(25000);expect(result.events).toHaveLength(26000);
 expect(applyEventBatch(snapshot,[event('1')]).events).toBe(events);
});
