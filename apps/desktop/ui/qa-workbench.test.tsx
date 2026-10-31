// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { fixture } from './qa-workbench.js';
const decision = {type:'run.approve' as const,sessionId:'conversation-fixture',runId:'approval-fixture',callId:'call-fixture',allowed:true};
it('provides scoped memory previews and rejects duplicate pending approvals', async () => {
 const bridge=fixture(25);
 const file=await bridge.request({type:'files.read',sessionId:'conversation-fixture',path:'README.md'});
 expect(file.file?.text).toContain('仅供 QA');
 await expect(bridge.request({type:'files.read',sessionId:'empty-fixture',path:'README.md'})).rejects.toThrow('权限');
 const pending=bridge.request(decision);
 expect((await bridge.request({type:'snapshot'})).snapshot?.sessions[0].activeRunId).toBe('approval-fixture');
 await expect(bridge.request(decision)).rejects.toThrow('待审批'); await pending;
 expect((await bridge.request({type:'files.read',sessionId:'conversation-fixture',path:'summary.md'})).file?.text).toContain('没有写入磁盘');
});
it('denying the QA call creates no memory file', async () => {
 const bridge=fixture(1); await bridge.request({...decision,allowed:false});
 await expect(bridge.request({type:'files.read',sessionId:'conversation-fixture',path:'summary.md'})).rejects.toThrow('不存在');
 expect((await bridge.request({type:'snapshot'})).snapshot?.events.some(e=>e.type==='tool_result'&&e.data.denied)).toBe(true);
});
