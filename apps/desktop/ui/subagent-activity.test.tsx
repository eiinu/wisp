// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import type {RunEvent} from '@wisp/core';
import {SubagentActivity} from './subagent-activity.js';
import {fixture} from './qa-workbench.js';
let root:Root,container:HTMLDivElement;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(()=>root.unmount());container.remove();});
const event=(runId:string,type:RunEvent['type'],data:RunEvent['data']={}):RunEvent=>({version:1,id:crypto.randomUUID(),sessionId:'s',parentRunId:'parent',runId,taskTitle:`Task ${runId}`,at:'',type,data});
it('keeps critical child interactions outside closed details, scoped controls and deduplicated pending clicks',async()=>{
 let release!:()=>void;const request=vi.fn(()=>new Promise<{}>(r=>{release=()=>r({});}));
 const events=[event('a','started'),event('a','approval_requested',{id:'same',name:'files_write',args:{path:'a.txt'},description:'Approve A only'}),event('b','started'),event('b','approval_requested',{id:'same',name:'files_write',args:{path:'b.txt'},description:'Approve B only'}),{...event('foreign','started'),sessionId:'other'}];
 await act(()=>root.render(<SubagentActivity events={[...events,events[1]]} parentRunId="parent" sessionId="s" connected request={request} openFile={()=>{}} canPreview/>));
 const cards=container.querySelectorAll('.subtask');expect(cards).toHaveLength(2);
 expect(cards[0].querySelector('details')!.open).toBe(false);expect(cards[0].querySelector('.approval')!.closest('details')).toBeNull();
 const approve=Array.from(cards[0].querySelectorAll('button')).find(b=>b.textContent==='批准执行')!;
 await act(()=>{approve.click();approve.click();});expect(request).toHaveBeenCalledTimes(1);expect(request).toHaveBeenLastCalledWith({type:'run.approve',sessionId:'s',runId:'a',callId:'same',allowed:true});
 expect(Array.from(cards[1].querySelectorAll('button')).find(b=>b.textContent==='批准执行')!.disabled).toBe(false);
 await act(()=>release());const stop=cards[1].querySelector('header button') as HTMLButtonElement;await act(()=>stop.click());expect(request).toHaveBeenLastCalledWith({type:'run.cancel',sessionId:'s',runId:'b'});await act(()=>release());
 await act(()=>root.render(<SubagentActivity events={[...events,event('a','cancelled',{reason:'user stopped'}),event('b','completed')]} parentRunId="parent" sessionId="s" connected request={request} openFile={()=>{}} canPreview/>));
 expect(container.querySelectorAll('header button')).toHaveLength(0);expect(container.querySelector('.approval')).toBeNull();expect(container.textContent).toContain('已停止');expect(request).toHaveBeenCalledTimes(2);
});
it('QA child stop/denial/answers preserve siblings and terminal parent history without executing real tools',async()=>{
 const bridge=fixture(1,false,'subagents');await bridge.request({type:'run.cancel',sessionId:'conversation-fixture',runId:'qa-child-write'});
 let snapshot=(await bridge.request({type:'snapshot'})).snapshot!;expect(snapshot.sessions[0].activeRunId).toBe('approval-fixture');expect(snapshot.events.some(e=>e.runId==='qa-child-write'&&e.type==='cancelled')).toBe(true);
 const q=snapshot.events.find(e=>e.runId==='qa-child-ask'&&e.type==='question_requested')!;
 await bridge.request({type:'run.answer',sessionId:'conversation-fixture',runId:q.runId,ticket:String(q.data.ticket),response:{status:'cancelled'}});
 snapshot=(await bridge.request({type:'snapshot'})).snapshot!;expect(snapshot.sessions[0].activeRunId).toBeUndefined();expect(snapshot.events.some(e=>e.runId==='qa-child-read'&&e.type==='completed')).toBe(true);
 await expect(bridge.request({type:'run.approve',sessionId:'conversation-fixture',runId:'qa-child-write',callId:'shared-call',allowed:true})).rejects.toThrow();
});
it('QA cancellation during pending child approval ignores late approval and leaves sibling question live',async()=>{
 const bridge=fixture(25,false,'subagents');const pending=bridge.request({type:'run.approve',sessionId:'conversation-fixture',runId:'qa-child-write',callId:'shared-call',allowed:true});
 const rejected=expect(pending).rejects.toThrow('停止');await bridge.request({type:'run.cancel',sessionId:'conversation-fixture',runId:'qa-child-write'});await rejected;
 const state=(await bridge.request({type:'snapshot'})).snapshot!;expect(state.sessions[0].activeRunId).toBe('approval-fixture');expect(state.events.some(e=>e.runId==='qa-child-write'&&e.type==='tool_result')).toBe(false);
});
