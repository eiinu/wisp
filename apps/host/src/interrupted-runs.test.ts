import {expect,it} from 'vitest';
import type {RunEvent} from '@wisp/core';
import {interruptedStarts} from './interrupted-runs.js';
it('scans terminal run IDs linearly even when thousands of persisted starts are already complete',()=>{
 let reads=0;const events=Array.from({length:5000},(_,i)=>['started','completed'].map(type=>({version:1 as const,id:`${i}-${type}`,at:'',type:type as RunEvent['type'],data:{},get runId(){reads++;return String(i);}}))).flat();
 expect(interruptedStarts(events)).toEqual([]);expect(reads).toBe(10000);
});
