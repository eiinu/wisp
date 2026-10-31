import { expect,it } from 'vitest';
import type {RunEvent} from '@wisp/core';
import {groupExecution} from './tool-groups.js';
const event=(id:string,type:RunEvent['type'],data:Record<string,unknown>):RunEvent=>({version:1,id,runId:'run',sessionId:'session',at:'',type,data});
it('groups real rounds and multiple tools without duplicating streamed or replayed events',()=>{
 const call=event('call','tool_requested',{id:'a',name:'files_list',step:0});
 const events=[event('delta','assistant_delta',{step:0,text:'partial'}),event('text','assistant',{step:0,text:'List first'}),call,call,event('call2','tool_requested',{id:'b',name:'files_read',step:0}),event('result','tool_result',{callId:'a',text:'ok'}),event('text2','assistant',{step:1,text:'Write next'}),event('call3','tool_requested',{id:'c',name:'files_write',step:1}),event('approval','approval_requested',{id:'c'}),event('final','assistant',{step:2,text:'Final answer'})];
 const grouped=groupExecution(events);
 expect(grouped.process.map(r=>r.step)).toEqual([0,1]);
 expect(grouped.process[0].text).toBe('List first');
 expect(grouped.process[0].events.filter(e=>e.type==='tool_requested')).toHaveLength(2);
 expect(grouped.process[1].events.at(-1)?.type).toBe('approval_requested');
 expect(grouped.answers.map(r=>r.text)).toEqual(['Final answer']);
 expect(groupExecution(JSON.parse(JSON.stringify(events)))).toEqual(grouped);
});
it('uses recorded historical model steps but never invents missing rounds or merges another run/session',()=>{
 const events=[event('a','tool_requested',{id:'legacy'}),event('b','tool_result',{callId:'legacy',isError:true}),event('c','model_finish',{step:3,reason:'tool_calls'}),event('d','tool_requested',{id:'recorded'}),event('e','cancelled',{}),{...event('foreign','tool_requested',{id:'other',step:4}),sessionId:'other'}];
 expect(groupExecution(events).process.map(r=>r.step)).toEqual([undefined,3]);
 expect(groupExecution([...events,{...events[3],id:'replayed-call'}]).process[1].events).toHaveLength(2);
});
