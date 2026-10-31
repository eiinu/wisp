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
it('keeps simulated MCP setup disabled until a separate activation approval and rejects repeated decisions',async()=>{
 for(const tool of ['mcp_install_npm','mcp_register']){
  const bridge=fixture(25,false,tool);const start=bridge.request(decision);await expect(bridge.request(decision)).rejects.toThrow('待审批');await start;
  let state=(await bridge.request({type:'snapshot'})).snapshot!;expect(state.mcpServers?.[0]?.state).toBe('disabled');expect(state.events.findLast(e=>e.type==='approval_requested')?.data.name).toBe('mcp_activate_service');
  const description=String(state.events.findLast(e=>e.type==='approval_requested')?.data.description),service=state.mcpServers![0];
  for(const detail of [service.name,service.command,JSON.stringify(service.args),'目录：用户主目录','环境变量名称：无','不受项目目录沙箱约束'])expect(description).toContain(detail);
  await expect(bridge.request(decision)).rejects.toThrow('待审批');await bridge.request({...decision,callId:'activation-fixture',allowed:false});state=(await bridge.request({type:'snapshot'})).snapshot!;
  expect(state.mcpServers?.[0]?.state).toBe('disabled');expect(state.events.findLast(e=>e.type==='tool_result')?.data.denied).toBe(true);
 }
 const denied=fixture(1,false,'mcp_install_npm');await denied.request({...decision,allowed:false});expect((await denied.request({type:'snapshot'})).snapshot?.mcpServers??[]).toHaveLength(0);
 const success=fixture(1,false,'mcp_install_npm');await success.request(decision);await success.request({...decision,callId:'activation-fixture'});expect((await success.request({type:'snapshot'})).snapshot?.mcpServers?.[0]?.state).toBe('connected');
});
it('routes memory questionnaire independently of approvals, rejects duplicates and preserves session ownership',async()=>{
 const bridge=fixture(25,false,'ask_user'),initial=(await bridge.request({type:'snapshot'})).snapshot!,event=initial.events.find(e=>e.type==='question_requested')!;
 await expect(bridge.request(decision)).rejects.toThrow('待审批');
 const request={type:'run.answer' as const,sessionId:'conversation-fixture',runId:event.runId,ticket:String(event.data.ticket),response:{status:'cancelled' as const}};
 await expect(bridge.request({...request,sessionId:'empty-fixture'})).rejects.toThrow('待回答');
 const sending=bridge.request(request);await expect(bridge.request(request)).rejects.toThrow('待回答');await bridge.request({type:'session.select',sessionId:'empty-fixture'});await sending;
 const events=(await bridge.request({type:'snapshot'})).snapshot!.events;expect(events.filter(e=>e.type==='question_resolved')).toHaveLength(1);expect(events.find(e=>e.type==='question_resolved')?.sessionId).toBe('conversation-fixture');expect(events.some(e=>e.type==='approval_resolved')).toBe(false);
});
it('tab action fixture uses same-session live tickets, explicit approval and memory-only refresh',async()=>{
 const bridge=fixture(1,false,'preview_tab_action');let ticket='';
 bridge.subscribe(n=>{if(n.type==='preview.tabs')void(async()=>{await bridge.request({type:'preview.tabs.claim',sessionId:n.sessionId,ticket:n.ticket});await bridge.request({type:'preview.tabs.complete',sessionId:n.sessionId,ticket:n.ticket,tabs:[{id:'memory-file',kind:'file',title:'Notes',path:'notes.txt',active:false,revision:1}]});})();if(n.type==='preview.action')ticket=n.ticket;});
 const tabs=await bridge.inspectTabs();await bridge.beginAction(tabs[0].tabId,'reload');let snapshot=(await bridge.request({type:'snapshot'})).snapshot!,runId=snapshot.sessions[0].activeRunId!;
 expect(ticket).toBe('');await bridge.request({type:'run.approve',sessionId:'conversation-fixture',runId,callId:'qa-tab-action',allowed:false});expect(ticket).toBe('');
 await bridge.beginAction(tabs[0].tabId,'reload');snapshot=(await bridge.request({type:'snapshot'})).snapshot!;runId=snapshot.sessions[0].activeRunId!;
 await bridge.request({type:'run.approve',sessionId:'conversation-fixture',runId,callId:'qa-tab-action',allowed:true});
 expect((await bridge.request({type:'preview.action.claim',sessionId:'conversation-fixture',ticket})).tabAction?.tab.id).toBe('memory-file');
 const result=await bridge.request({type:'preview.action.execute',sessionId:'conversation-fixture',ticket});expect(result.file?.text).toContain('QA：已重新读取内存内容');
 await expect(bridge.request({type:'preview.action.execute',sessionId:'conversation-fixture',ticket})).rejects.toThrow('重复');await bridge.request({type:'preview.action.complete',sessionId:'conversation-fixture',ticket,applied:true});
 expect((await bridge.request({type:'snapshot'})).snapshot?.sessions[0].activeRunId).toBeUndefined();
});
