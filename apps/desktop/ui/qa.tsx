import React, { useEffect, useReducer, useState } from 'react';
import { QAWorkbench } from './qa-workbench.js';
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
const sample = '# Markdown 组件样例\n\n行内公式 $a+b=c$ 与 $\\frac{1}{2}\\pi r^2$。\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n\n```typescript\nconst greeting: string = "Hello Wisp";\nconsole.log(greeting);\n```\n\n| 类型 | 状态 |\n| --- | --- |\n| 数学 | 本地排版 |\n| 高亮 | 8 种语言 |\n\n[打开 example.com](https://example.com) · [打开纯文本文件](notes.txt)\n\n> 所有内容均为开发测试样例，没有模型或 Host 连接。\n\n## 列表排版样例\n\n- 普通列表第一项\n- 普通列表第二项\n  - 二级列表\n    - 三级列表\n\n1. 编号列表第一项\n2. 编号列表第二项\n   1. 嵌套编号一\n   2. 嵌套编号二\n\n- [x] 已完成任务样例\n- [ ] 未完成任务样例';
const fixtures = { 'readme.md': sample, 'notes.txt': '开发测试纯文本文件\n\n$a+b=c$ 在 txt 中保持原文。\n<script>不会执行</script>\n中文与 UTF-8 😀' };
async function fixtureRequest(input: Request): Promise<Result> {
  if(input.type==='files.list') return { entries: Object.entries(fixtures).map(([path,text])=>({path,name:path,kind:'file',size:new TextEncoder().encode(text).length})) };
  if(input.type==='files.read' && input.path in fixtures) { const text=fixtures[input.path as keyof typeof fixtures];return {file:{path:input.path,kind:input.path.endsWith('.md')?'markdown':'text',text,size:new TextEncoder().encode(text).length}}; }
  throw new Error('开发组件样例仅提供两个只读测试文件，不执行 Host 操作。');
}
function QA() {
 const [workbench,setWorkbench]=useState(false);
 const [webTool,setWebTool]=useState(false);
 const [basicTool,setBasicTool]=useState('');
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
 if(workbench)return <div className="qa-shell"><div className="qa-banner"><strong>开发工作台样例 · 内存 fixture，不是真实 Host 连接</strong><p>消息/审批为测试数据，所有操作不读写真实文件、不调用模型。请勿输入真实 Key。</p><button onClick={()=>setWorkbench(false)}>返回组件样例</button><button onClick={()=>{setBasicTool('');setWebTool(value=>!value);}}>{webTool?'切换文件审批样例':'切换打开网页工具样例'}</button><label>工具交互样例<select aria-label="工具交互样例" value={basicTool} onChange={e=>{setWebTool(false);setBasicTool(e.target.value);}}><option value="">写入文件</option><option value="files_replace">定点修改</option><option value="files_mkdir">创建目录</option><option value="files_move">移动 / 重命名</option><option value="files_trash">移入废纸篓</option><option value="mcp_qa_echo">本地 MCP 审批（内存）</option><option value="read_webpage">读取网页正文</option></select></label></div><div className="qa-workbench"><QAWorkbench key={String(webTool)+basicTool} web={webTool} basic={basicTool}/></div></div>;
 return <LinkConfirmationProvider onOpen={open}><div className="qa-shell"><div className="qa-banner">开发组件验证 · 测试样例 · 无模型 / 无 Host / 不写入文件。桌面原生导航和下载不在此 Web 页面验证。<button onClick={()=>setWorkbench(true)}>打开对话工作台样例</button></div><div className="qa-layout"><aside className="sidebar qa-project-sidebar"><div className="brand"><strong>项目交互样例</strong></div><ProjectSidebar projects={projects} sessions={sessions} selected={selected} connected request={request} select={setSelected} onDialogChange={setDialog} chooseDirectory={async()=>'/qa/new-project-fixture'} openDirectory={id=>{setSelected(id);dispatch({type:'open',target:{kind:'workspace'}});setVisible(true);}}/></aside><SplitWorkspace visible={visible} right={({dragging})=><BrowserPanel state={state} dispatch={dispatch} visible={visible} blocked={dragging||dialog} close={()=>setVisible(false)} sessionId={selected} workspace={workspace} inheritedWorkspace={!!current?.projectId} connected active={false} request={request} chooseWorkspace={()=>{}}/>}><main className="qa-content"><p className="file-status">当前样例：{current?.title} · {workspace}（内存数据，选择器返回测试路径，不授予真实权限）</p><button onClick={()=>setVisible(!visible)}>切换工作区</button><Markdown text={sample} source={{kind:'file',sessionId:selected??'qa-fixture',workspace,path:'readme.md'}}/><form className="qa-forms" aria-label="基础表单样式验证" onSubmit={e=>e.preventDefault()}><h3>基础控件样例（不保存、不发送）</h3><p>鼠标点击与 Tab 切换检查焦点。项目弹窗、右侧地址栏使用相同基础样式。</p><label>文本<input placeholder="输入文字检查焦点"/></label><label>密码<input type="password" autoComplete="off" placeholder="仅输入测试文字，不输入真实 Key"/></label><label>搜索<input type="search" placeholder="保留原生清除操作"/></label><label>模型下拉<select defaultValue="a"><option value="a">模型样例 A</option><option value="b">模型样例 B</option></select></label><label>编辑器<textarea className="file-editor" defaultValue="测试文件内容"/></label><label><input type="checkbox" defaultChecked/>复选框</label><label><input type="radio" name="qa-radio" defaultChecked/>选项一</label><label><input type="radio" name="qa-radio"/>选项二</label><label>禁用输入<input disabled defaultValue="不可编辑"/></label><label><input type="checkbox" disabled defaultChecked/>禁用复选框</label><button disabled>禁用按钮</button><div className="composer"><textarea aria-label="聊天输入样例" placeholder="输入区以外框显示键盘焦点"/></div><button type="submit">测试按钮（无副作用）</button></form><h3>图标集合（真实 SVG 组件样例）</h3><div className="qa-icons">{(Object.keys(iconPaths) as (keyof typeof iconPaths)[]).map(name=><div key={name}><button aria-label={`样例图标 ${name}`}><WorkspaceIcon name={name}/><small>{name}</small></button><button disabled aria-label={`禁用样例 ${name}`}><WorkspaceIcon name={name}/></button></div>)}</div><h3>流式未闭合样例</h3><Markdown text={'未完成公式 $\\frac{a}{b\n\n```python\nprint("streaming")'}/></main></SplitWorkspace></div></div></LinkConfirmationProvider>;
}
createRoot(document.getElementById('root')!).render(<QA/>);
