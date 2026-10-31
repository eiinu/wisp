import React, { useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Markdown } from './markdown.js';
import { SplitWorkspace } from './split-workspace.js';
import { BrowserPanel } from './browser-panel.js';
import { LinkConfirmationProvider } from './link-confirmation.js';
import { previewReducer, type PreviewTarget } from './preview-model.js';
import type { Request, Result } from '@wisp/core';
import './style.css';
const sample = '# Markdown 组件样例\n\n行内公式 $a+b=c$ 与 $\\frac{1}{2}\\pi r^2$。\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n\n```typescript\nconst greeting: string = "Hello Wisp";\nconsole.log(greeting);\n```\n\n| 类型 | 状态 |\n| --- | --- |\n| 数学 | 本地排版 |\n| 高亮 | 8 种语言 |\n\n[打开 example.com](https://example.com) · [打开纯文本文件](notes.txt)\n\n> 所有内容均为开发测试样例，没有模型或 Host 连接。';
const fixtures = { 'readme.md': sample, 'notes.txt': '开发测试纯文本文件\n\n$a+b=c$ 在 txt 中保持原文。\n<script>不会执行</script>\n中文与 UTF-8 😀' };
async function request(input: Request): Promise<Result> {
  if(input.type==='files.list') return { entries: Object.entries(fixtures).map(([path,text])=>({path,name:path,kind:'file',size:new TextEncoder().encode(text).length})) };
  if(input.type==='files.read' && input.path in fixtures) { const text=fixtures[input.path as keyof typeof fixtures];return {file:{path:input.path,kind:input.path.endsWith('.md')?'markdown':'text',text,size:new TextEncoder().encode(text).length}}; }
  throw new Error('开发组件样例仅提供两个只读测试文件，不执行 Host 操作。');
}
function QA() {
 const [state,dispatch]=useReducer(previewReducer,{tabs:[{kind:'workspace',id:'workspace',title:'样例文件'}],activeId:'workspace'});
 const [visible,setVisible]=useState(true);
 const open=(target:PreviewTarget)=>{dispatch({type:'open',target});setVisible(true);};
 return <LinkConfirmationProvider onOpen={open}><div className="qa-shell"><div className="qa-banner">开发组件验证 · 测试样例 · 无模型 / 无 Host / 不写入文件。桌面原生导航和下载不在此 Web 页面验证。</div><div className="qa-layout"><SplitWorkspace visible={visible} right={({dragging})=><BrowserPanel state={state} dispatch={dispatch} visible={visible} blocked={dragging} close={()=>setVisible(false)} sessionId="qa" workspace="fixture-only" connected active={false} request={request} chooseWorkspace={()=>{}}/>}><main className="qa-content"><button onClick={()=>setVisible(!visible)}>切换工作区</button><Markdown text={sample} source={{kind:'file',sessionId:'qa',workspace:'fixture-only',path:'readme.md'}}/><h3>流式未闭合样例</h3><Markdown text={'未完成公式 $\\frac{a}{b\n\n```python\nprint("streaming")'}/></main></SplitWorkspace></div></div></LinkConfirmationProvider>;
}
createRoot(document.getElementById('root')!).render(<QA/>);
