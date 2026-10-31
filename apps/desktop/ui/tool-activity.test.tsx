// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { RunEvent } from '@wisp/core';
import {fixture} from './qa-workbench.js';
import { ToolActivity } from './tool-activity.js';
let container: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(() => root.unmount()); container.remove(); });
const render = async (node: React.ReactNode) => { await act(() => root.render(node)); };
const events: RunEvent[] = [
 {version:1,id:'req',runId:'r',at:'',type:'tool_requested',data:{id:'c',name:'files_read',args:{path:'note.md'}}},
 {version:1,id:'res',runId:'r',at:'',type:'tool_result',data:{callId:'c',text:'contents'}}
];
it('correlates tool results and opens a file only through the scoped callback', async () => {
 const open = vi.fn(); await render(<ToolActivity events={events} ended canPreview openFile={open}/>);
 expect(container.textContent).toContain('读取文件'); expect(container.textContent).toContain('已完成');
 await act(() => container.querySelector('button')!.click()); expect(open).toHaveBeenCalledWith('note.md');
});
it('does not offer previews for failed or denied results and marks unfinished calls interrupted', async () => {
 const open = vi.fn(); await render(<ToolActivity events={[events[0],{...events[1],data:{...events[1].data,isError:true}}]} ended canPreview openFile={open}/>);
 expect(container.querySelector('button')).toBeNull(); expect(container.textContent).toContain('失败');
 await render(<ToolActivity events={[events[0]]} ended canPreview={false} openFile={open}/>); expect(container.textContent).toContain('已中断');
});
it('explains why a successful file result cannot currently be previewed', async () => {
 await render(<ToolActivity events={events} ended canPreview={false} previewUnavailableReason="此会话尚未授权工作目录" openFile={vi.fn()}/>);
 expect(container.querySelector('button')!.disabled).toBe(true);
 expect(container.querySelector('button')!.title).toBe('此会话尚未授权工作目录');
 expect(container.querySelector('.file-status')!.textContent).toBe('此会话尚未授权工作目录');
});
it('collapses completed execution by default while keeping failed status visible outside it', async () => {
 await render(<ToolActivity events={events} ended canPreview openFile={vi.fn()}/>);
 expect(container.querySelector<HTMLDetailsElement>('.execution-process')!.open).toBe(false);
 expect(container.querySelector('.execution-round')!.textContent).toContain('未记录轮次');
 await render(<ToolActivity events={[events[0],{...events[1],data:{...events[1].data,isError:true}}]} ended canPreview openFile={vi.fn()}/>);
 const process=container.querySelector<HTMLDetailsElement>('.execution-process')!;
 process.open=false;
 expect(container.querySelector('[role=status]')!.closest('details')).toBeNull();
 expect(container.querySelector('[role=status]')!.textContent).toContain('1 项失败');
});
it('search results open only scoped file previews and replacement keeps its preview action',async()=>{
 const open=vi.fn();const search=events.map(e=>({...e,data:e.type==='tool_requested'?{id:'c',name:'files_search',args:{path:'',query:'hello',mode:'content'}}:{callId:'c',text:JSON.stringify({matches:[{path:'note.md',line:2,snippet:'hello'}]})}}));
 await render(<ToolActivity events={search} ended canPreview openFile={open}/>);expect(container.textContent).toContain('搜索文件');await act(()=>container.querySelector('button')!.click());expect(open).toHaveBeenCalledWith('note.md');
 await render(<ToolActivity events={search} ended canPreview={false} previewUnavailableReason="未授权" openFile={open}/>);expect(container.querySelector('button')!.disabled).toBe(true);
 const replace=events.map(e=>({...e,data:e.type==='tool_requested'?{id:'c',name:'files_replace',args:{path:'note.md',oldText:'old',newText:'new'}}:e.data}));await render(<ToolActivity events={replace} ended canPreview openFile={open}/>);expect(container.textContent).toContain('定点修改');expect(container.querySelector('button')!.textContent).toContain('预览文件');
});
it('shows MCP service and remote name within the existing execution hierarchy without granting file preview',async()=>{
 const mcpEvents=events.map(e=>({...e,data:e.type==='tool_requested'?{...e.data,name:'mcp_opaque_echo',source:{serviceId:'fixture',serviceName:'QA 服务',toolName:'echo'}}:e.data}));
 await render(<ToolActivity events={mcpEvents} ended canPreview openFile={vi.fn()}/>);
 expect(container.querySelector('.tool-trace summary strong')?.textContent).toBe('QA 服务 · echo');
 expect(container.querySelector('button')).toBeNull();expect(container.querySelector<HTMLDetailsElement>('.execution-process')!.open).toBe(false);
});
it('distinguishes installation, registration and activation in chat tool summaries',async()=>{
 for(const [name,label] of [['mcp_register','注册已有 MCP'],['mcp_install_npm','安装并注册 MCP'],['mcp_activate_service','激活并检查 MCP']]){
  await render(<ToolActivity events={[{...events[0],data:{id:'c',name,args:{}}}]} ended={false} canPreview={false} openFile={vi.fn()}/>);
  expect(container.querySelector('.tool-trace summary strong')?.textContent).toBe(label);expect(container.querySelector('button')).toBeNull();
 }
});

it('renders a rejected tab action from the real QA event contract as denied even when collapsed',async()=>{
 const bridge=fixture(10,false,'preview_tab_action');let deliveries=0;
 bridge.subscribe(n=>{if(n.type==='preview.tabs')void(async()=>{await bridge.request({type:'preview.tabs.claim',sessionId:n.sessionId,ticket:n.ticket});await bridge.request({type:'preview.tabs.complete',sessionId:n.sessionId,ticket:n.ticket,tabs:[{id:'new',kind:'new',title:'New',active:true}]});})();if(n.type==='preview.action')deliveries++;});
 const tabs=await bridge.inspectTabs();await bridge.beginAction(tabs[0].tabId,'close');const runId=(await bridge.request({type:'snapshot'})).snapshot!.sessions[0].activeRunId!;
 const decision={type:'run.approve' as const,sessionId:'conversation-fixture',runId,callId:'qa-tab-action',allowed:false};
 const pending=bridge.request(decision);await expect(bridge.request(decision)).rejects.toThrow('失效');await pending;
 const events=(await bridge.request({type:'snapshot'})).snapshot!.events.filter(e=>e.runId===runId);
 expect(events.filter(e=>e.type==='tool_result')).toHaveLength(1);expect(events.find(e=>e.type==='tool_result')?.data.denied).toBe(true);expect(deliveries).toBe(0);
 await render(<ToolActivity events={events} ended canPreview={false} openFile={vi.fn()}/>);
 expect(container.textContent).not.toContain('已完成');expect(container.textContent).toContain('已拒绝');
 const details=container.querySelector<HTMLDetailsElement>('.execution-process')!;details.open=false;
 expect(container.querySelector('[role=status]')!.textContent).toContain('1 项已拒绝');expect(container.querySelector('[role=status]')!.closest('details')).toBeNull();
});
