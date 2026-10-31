// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {fixture} from './qa-workbench.js';
it('QA replacement, rename and trash operate only on the explicit memory fixture and support denial',async()=>{
 for(const name of ['files_replace','files_move','files_trash','files_mkdir']){
 const bridge=fixture(1,false,name);const before=(await bridge.request({type:'snapshot'})).snapshot!;expect(before.events.find(e=>e.type==='approval_requested')?.data.name).toBe(name);
 await bridge.request({type:'run.approve',sessionId:'conversation-fixture',runId:'approval-fixture',callId:'call-fixture',allowed:false});
 expect((await bridge.request({type:'files.read',sessionId:'conversation-fixture',path:'notes.txt'})).file?.text).toContain('QA');
 expect((await bridge.request({type:'snapshot'})).snapshot!.events.findLast(e=>e.type==='tool_result')?.data.denied).toBe(true);
 }
 const approved=fixture(1,false,'files_replace');await approved.request({type:'run.approve',sessionId:'conversation-fixture',runId:'approval-fixture',callId:'call-fixture',allowed:true});expect((await approved.request({type:'files.read',sessionId:'conversation-fixture',path:'notes.txt'})).file?.text).toBe('修改后的 QA 内存笔记');
});

it('QA webpage reading requires a freshly listed explicit web tab and never extracts actual content',async()=>{
 const bridge=fixture(1,false,'read_webpage');let rows=[{id:'web-one',kind:'web' as const,url:'https://example.com/',title:'First',active:true},{id:'web-two',kind:'web' as const,url:'https://example.org/',title:'Second',active:false}];
 bridge.subscribe(n=>{if(n.type==='preview.tabs')void(async()=>{await bridge.request({type:'preview.tabs.claim',sessionId:n.sessionId,ticket:n.ticket});await bridge.request({type:'preview.tabs.complete',sessionId:n.sessionId,ticket:n.ticket,tabs:rows});})();});
 await expect(bridge.beginRead('unknown')).rejects.toThrow('先获取');const list=await bridge.inspectTabs();await bridge.beginRead(list[1].tabId);
 const state=(await bridge.request({type:'snapshot'})).snapshot!;expect(state.events.findLast(e=>e.type==='tool_requested')?.data.args).toEqual({tabId:list[1].tabId});
 expect(state.events.some(e=>e.type==='approval_requested'||e.type==='approval_resolved')).toBe(false);
 expect((await bridge.request({type:'snapshot'})).snapshot!.events.findLast(e=>e.type==='tool_result')?.data.text).toContain('没有读取真实页面');rows=rows.slice(0,1);await expect(bridge.beginRead(list[1].tabId)).rejects.toThrow('关闭');
});

it('QA readonly execution can be cancelled without approval or a late result',async()=>{
 const bridge=fixture(50,false,'read_webpage');
 bridge.subscribe(n=>{if(n.type==='preview.tabs')void(async()=>{await bridge.request({type:'preview.tabs.claim',sessionId:n.sessionId,ticket:n.ticket});await bridge.request({type:'preview.tabs.complete',sessionId:n.sessionId,ticket:n.ticket,tabs:[{id:'web',kind:'web',url:'https://example.com/',title:'Page',active:true}]});})();});
 const tabs=await bridge.inspectTabs(),reading=bridge.beginRead(tabs[0].tabId);
 let runId='';await vi.waitFor(async()=>{runId=(await bridge.request({type:'snapshot'})).snapshot!.sessions[0].activeRunId!;expect(runId).toBeTruthy();},{interval:1});
 await bridge.request({type:'run.cancel',sessionId:'conversation-fixture',runId});await reading;
 const events=(await bridge.request({type:'snapshot'})).snapshot!.events.filter(e=>e.runId===runId);
 expect(events.some(e=>e.type==='cancelled')).toBe(true);expect(events.some(e=>['approval_requested','tool_result','completed'].includes(e.type))).toBe(false);
});

it('QA list records belong to the requesting session, including empty lists',async()=>{
 const bridge=fixture(1,false,'read_webpage');
 bridge.subscribe(n=>{if(n.type==='preview.tabs')void(async()=>{await bridge.request({type:'preview.tabs.claim',sessionId:n.sessionId,ticket:n.ticket});await bridge.request({type:'preview.tabs.complete',sessionId:n.sessionId,ticket:n.ticket,tabs:[]});})();});
 const before=(await bridge.request({type:'snapshot'})).snapshot!.events;
 await bridge.request({type:'session.select',sessionId:'empty-fixture'});expect(await bridge.inspectTabs()).toEqual([]);
 const added=(await bridge.request({type:'snapshot'})).snapshot!.events.slice(before.length);
 expect(added.map(e=>e.type)).toEqual(['started','tool_requested','tool_result','completed']);expect(added.every(e=>e.sessionId==='empty-fixture')).toBe(true);
 await bridge.request({type:'session.select',sessionId:'conversation-fixture'});await bridge.inspectTabs();
 expect((await bridge.request({type:'snapshot'})).snapshot!.events.slice(-4).every(e=>e.sessionId==='conversation-fixture')).toBe(true);
});
it('QA list changing session before delivery cannot publish to either session',async()=>{
 const bridge=fixture(1,false,'read_webpage');let finish:()=>Promise<void>=async()=>{};
 bridge.subscribe(n=>{if(n.type==='preview.tabs')finish=async()=>{await bridge.request({type:'preview.tabs.claim',sessionId:n.sessionId,ticket:n.ticket});const completing=bridge.request({type:'preview.tabs.complete',sessionId:n.sessionId,ticket:n.ticket,tabs:[]});await bridge.request({type:'session.select',sessionId:'empty-fixture'});await completing;};});
 const before=(await bridge.request({type:'snapshot'})).snapshot!.events.length,pending=bridge.inspectTabs();
 const rejected=expect(pending).rejects.toThrow('会话已切换');await finish();await rejected;
 expect((await bridge.request({type:'snapshot'})).snapshot!.events).toHaveLength(before);
});
