import {expect,it} from 'vitest';
import type {RunEvent} from '@wisp/core';
import {indexToolRound} from './tool-index.js';
const event=(type:RunEvent['type'],data:RunEvent['data']):RunEvent=>({version:1,id:'e',runId:'r',at:'',type,data});
it('preserves first result, concurrent call correlation and approval/question state',()=>{
 const first=event('tool_result',{callId:'a',text:'first'});
 const index=indexToolRound([event('tool_started',{callId:'a'}),event('approval_requested',{id:'a'}),event('approval_resolved',{callId:'a',allowed:true}),event('question_requested',{callId:'a'}),event('question_requested',{callId:'b'}),event('question_resolved',{callId:'b'}),first,event('tool_result',{callId:'a',text:'replay'}),event('tool_result',{callId:'b',denied:true})]);
 expect(index.results.get('a')).toBe(first);expect(index.results.get('b')?.data.denied).toBe(true);
 expect(index.started.has('a')&&index.approvals.has('a')&&index.allowed.has('a')).toBe(true);
 expect(index.questions.has('a')&&!index.answered.has('a')).toBe(true);expect(index.answered.has('b')).toBe(true);
});
it('reads a large round once instead of scanning per call',()=>{
 let reads=0;const events=Array.from({length:6000},()=>({...event('tool_started',{}),get data(){reads++;return {callId:'a'};}}));
 indexToolRound(events);expect(reads).toBe(6000);
});
