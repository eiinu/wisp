// @vitest-environment jsdom
import {it,expect} from 'vitest';
import {fixture} from './qa-workbench.js';
it('QA replacement, rename and trash operate only on the explicit memory fixture and support denial',async()=>{
 for(const name of ['files_replace','files_move','files_trash','files_mkdir','read_webpage']){
 const bridge=fixture(1,false,name);const before=(await bridge.request({type:'snapshot'})).snapshot!;expect(before.events.find(e=>e.type==='approval_requested')?.data.name).toBe(name);
 await bridge.request({type:'run.approve',sessionId:'conversation-fixture',runId:'approval-fixture',callId:'call-fixture',allowed:false});
 expect((await bridge.request({type:'files.read',sessionId:'conversation-fixture',path:'notes.txt'})).file?.text).toContain('QA');
 expect((await bridge.request({type:'snapshot'})).snapshot!.events.findLast(e=>e.type==='tool_result')?.data.denied).toBe(true);
 }
 const approved=fixture(1,false,'files_replace');await approved.request({type:'run.approve',sessionId:'conversation-fixture',runId:'approval-fixture',callId:'call-fixture',allowed:true});expect((await approved.request({type:'files.read',sessionId:'conversation-fixture',path:'notes.txt'})).file?.text).toBe('修改后的 QA 内存笔记');
});
