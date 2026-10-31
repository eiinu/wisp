import React, { useEffect, useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectSidebar } from './project-sidebar.js';
import { Markdown } from './markdown.js';
import { SplitWorkspace } from './split-workspace.js';
import { BrowserPanel } from './browser-panel.js';
import { LinkConfirmationProvider } from './link-confirmation.js';
import { previewReducer, type PreviewTarget } from './preview-model.js';
import type { Request, Result, ProjectInfo, SessionInfo } from '@wisp/core';
import { WorkspaceIcon, iconPaths } from './workspace-icon.js';
import './style.css';
const sample = '# Markdown 组件样例\n\n行内公式 $a+b=c$ 与 $\\frac{1}{2}\\pi r^2$。\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n\n```typescript\nconst greeting: string = "Hello Wisp";\nconsole.log(greeting);\n```\n\n| 类型 | 状态 |\n| --- | --- |\n| 数学 | 本地排版 |\n| 高亮 | 8 种语言 |\n\n[打开 example.com](https://example.com) · [打开纯文本文件](notes.txt)\n\n> 所有内容均为开发测试样例，没有模型或 Host 连接。';
const fixtures = { 'readme.md': sample, 'notes.txt': '开发测试纯文本文件\n\n$a+b=c$ 在 txt 中保持原文。\n<script>不会执行</script>\n中文与 UTF-8 😀' };
async function fixtureRequest(input: Request): Promise<Result> {
  if(input.type==='files.list') return { entries: Object.entries(fixtures).map(([path,text])=>({path,name:path,kind:'file',size:new TextEncoder().encode(text).length})) };
  if(input.type==='files.read' && input.path in fixtures) { const text=fixtures[input.path as keyof typeof fixtures];return {file:{path:input.path,kind:input.path.endsWith('.md')?'markdown':'text',text,size:new TextEncoder().encode(text).length}}; }
  throw new Error('开发组件样例仅提供两个只读测试文件，不执行 Host 操作。');
}
function QA() {
 const [state,dispatch]=useReducer(previewReducer,{tabs:[{kind:'workspace',id:'workspace',title:'样例文件'}],activeId:'workspace'});
 const [visible,setVisible]=useState(true),[dialog,setDialog]=useState(false),[selected,setSelected]=useState<string | undefined>('qa-a');
 const [projects,setProjects]=useState<ProjectInfo[]>([{id:'project-a',name:'研究笔记（样例）',workspace:'/qa/research',collapsed:false,createdAt:'2026-10-31'},{id:'project-b',name:'旅行计划（样例）',workspace:'/qa/travel',collapsed:true,createdAt:'2026-10-31'}]);
 const [sessions,setSessions]=useState<SessionInfo[]>([{id:'qa-a',projectId:'project-a',title:'资料整理（样例）',createdAt:'2026-10-31',updatedAt:'2026-10-31'},{id:'qa',title:'独立对话（样例）',createdAt:'2026-10-31',updatedAt:'2026-10-31'}]);
 const current=sessions.find(s=>s.id===selected),workspace=projects.find(p=>p.id===current?.projectId)?.workspace??'fixture-only';
 useEffect(()=>dispatch({type:'scope',sessionId:selected,workspace}),[selected,workspace]);
 async function request(input:Request):Promise<Result>{
  if(input.type==='project.create'){const id=crypto.randomUUID();setProjects(p=>[...p,{id,name:input.name??input.path.split('/').at(-1)??'样例',workspace:input.path,collapsed:false,createdAt:'2026-10-31'}]);return {projectId:id};}
  if(input.type==='project.rename'){setProjects(p=>p.map(v=>v.id===input.projectId?{...v,name:input.name}:v));return {};}
  if(input.type==='project.collapse'){setProjects(p=>p.map(v=>v.id===input.projectId?{...v,collapsed:input.collapsed}:v));return {};}
  if(input.type==='session.create'){const id=crypto.randomUUID();setSessions(s=>[...s,{id,projectId:input.projectId,title:'新会话（样例）',createdAt:'2026-10-31',updatedAt:'2026-10-31'}]);return {sessionId:id};}
  if(input.type==='session.archive'||input.type==='session.restore'){
   const archived=input.type==='session.archive',target=sessions.find(s=>s.id===input.sessionId);
   setSessions(items=>items.map(s=>s.id===input.sessionId?{...s,archivedAt:archived?new Date().toISOString():undefined}:s));
   if(archived&&selected===input.sessionId)setSelected(sessions.find(s=>s.id!==input.sessionId&&!s.archivedAt&&s.projectId===target?.projectId)?.id);
   if(!archived&&target?.projectId)setProjects(items=>items.map(p=>p.id===target.projectId?{...p,collapsed:false}:p));
   return {};
  }
  return fixtureRequest(input);
 }
 const open=(target:PreviewTarget)=>{dispatch({type:'open',target});setVisible(true);};
 return <LinkConfirmationProvider onOpen={open}><div className="qa-shell"><div className="qa-banner">开发组件验证 · 测试样例 · 无模型 / 无 Host / 不写入文件。桌面原生导航和下载不在此 Web 页面验证。</div><div className="qa-layout"><aside className="sidebar qa-project-sidebar"><div className="brand"><strong>项目交互样例</strong></div><ProjectSidebar projects={projects} sessions={sessions} selected={selected} connected request={request} select={setSelected} onDialogChange={setDialog} chooseDirectory={async()=>'/qa/new-project-fixture'} openDirectory={id=>{setSelected(id);dispatch({type:'open',target:{kind:'workspace'}});setVisible(true);}}/></aside><SplitWorkspace visible={visible} right={({dragging})=><BrowserPanel state={state} dispatch={dispatch} visible={visible} blocked={dragging||dialog} close={()=>setVisible(false)} sessionId={selected} workspace={workspace} inheritedWorkspace={!!current?.projectId} connected active={false} request={request} chooseWorkspace={()=>{}}/>}><main className="qa-content"><p className="file-status">当前样例：{current?.title} · {workspace}（内存数据，选择器返回测试路径，不授予真实权限）</p><button onClick={()=>setVisible(!visible)}>切换工作区</button><Markdown text={sample} source={{kind:'file',sessionId:selected??'qa-fixture',workspace,path:'readme.md'}}/><h3>图标集合（真实 SVG 组件样例）</h3><div className="qa-icons">{(Object.keys(iconPaths) as (keyof typeof iconPaths)[]).map(name=><div key={name}><button aria-label={`样例图标 ${name}`}><WorkspaceIcon name={name}/><small>{name}</small></button><button disabled aria-label={`禁用样例 ${name}`}><WorkspaceIcon name={name}/></button></div>)}</div><h3>流式未闭合样例</h3><Markdown text={'未完成公式 $\\frac{a}{b\n\n```python\nprint("streaming")'}/></main></SplitWorkspace></div></div></LinkConfirmationProvider>;
}
createRoot(document.getElementById('root')!).render(<QA/>);
