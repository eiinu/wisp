/** Development-only fixture for the real App, imported exclusively by qa.html. */
import React, { useState } from 'react';
import type { Notice, Request, Result, RunEvent, Snapshot, WorkbenchBridge } from '@wisp/core';
import { App } from './app.js';

export function fixture(approvalDelay = 1800, web = false): WorkbenchBridge {
  const files = new Map([['notes.txt', '补充笔记：仅 QA 内存数据'], ['README.md', '# 内存文件预览样例\n\n仅供 QA；没有读取磁盘或授予真实文件权限。']]);
  let approvalPending = false, previewClaimed=false;
  let previewResolve: ((accepted:boolean)=>void)|undefined;
  const ticket='qa-preview-ticket';
  const listeners = new Set<(notice: Notice) => void>();
  const event = (id: string, runId: string, type: RunEvent['type'], data: Record<string, unknown>): RunEvent => ({ version: 1, id, sessionId: 'conversation-fixture', runId, type, at: '2026-10-31T00:00:00Z', data });
  const state: Snapshot = {
    sessions: [{id:'conversation-fixture',workspace:'/QA-memory-only',title:'整理研究资料（交互样例）',createdAt:'',updatedAt:'',activeRunId:'approval-fixture'},{id:'empty-fixture',title:'空白对话（样例）',createdAt:'',updatedAt:''}], selectedId:'conversation-fixture',
    keyPresent:false,browserConnected:false,config:{provider:'offline',model:'offline-test',baseUrl:''},
    events:[
      event('start-1','completed-fixture','started',{prompt:'帮我整理本周的研究笔记，并总结下一步。'}),
      event('answer-1','completed-fixture','assistant',{step:2,text:'## 本周进展\n\n这是一段**明确标注的组件测试内容**，不是模型生成结果。\n\n- 已整理资料与关键结论\n- 下一步：核对来源并补充实验\n\n行内公式 $a+b=c$。\n\n```typescript\nconst notes = ["观察", "结论"];\nconsole.log(notes);\n```\n\n[查看链接确认样例](https://example.com)\n\n'+Array.from({length:6},(_,i)=>`第 ${i+1} 段：长内容用于检查阅读宽度、滚动与复制操作。`).join('\n\n')}),
      event('plan-round-0','completed-fixture','assistant',{step:0,text:'组件样例：先浏览目录和阅读说明。'}),
      event('list-request','completed-fixture','tool_requested',{step:0,id:'list-fixture',name:'files_list',args:{path:''}}),
      event('list-result','completed-fixture','tool_result',{callId:'list-fixture',text:'README.md, notes.txt（内存样例）'}),
      event('read-request','completed-fixture','tool_requested',{step:0,id:'read-fixture',name:'files_read',args:{path:'README.md'}}),
      event('read-result','completed-fixture','tool_result',{callId:'read-fixture',text:'组件样例文本；未读取磁盘。'}),
      event('round-1','completed-fixture','assistant',{step:1,text:'组件样例：再读取补充笔记。'}),
      event('read-next','completed-fixture','tool_requested',{step:1,id:'next-fixture',name:'files_read',args:{path:'notes.txt'}}),
      event('next-result','completed-fixture','tool_result',{callId:'next-fixture',text:'内存补充笔记'}),
      event('done-1','completed-fixture','completed',{}),
      event('start-2','approval-fixture','started',{prompt:'把摘要保存为笔记。'}),
      event('answer-2','approval-fixture','assistant',{text:'以下为审批组件样例。批准或拒绝等待约 1.8 秒，仅改变页面内存，不会写入文件。刷新 QA 页面可重置后测试另一种决定。'}),
      event('request-2','approval-fixture','tool_requested',{id:'call-fixture',name:'files_write',args:{path:'summary.md',content:'# 测试摘要'}}),
      event('approval-2','approval-fixture','approval_requested',{id:'call-fixture',name:'files_write',description:'测试审批：不会执行真实文件操作。',args:{path:'summary.md',content:'# 测试摘要'}}),
    ],
  };
  if(web) for(const e of state.events.filter(e=>['tool_requested','approval_requested'].includes(e.type)&&e.runId==='approval-fixture')) { e.data.name='open_webpage';e.data.args={url:'https://example.com/'}; e.data.description='打开网页展示样例：批准后在右侧请求加载 example.com；不读取页面，可能受到嵌入限制。'; }
  // The final answer follows the tool rounds in the actual event sequence.
  const answerIndex=state.events.findIndex(e=>e.id==='answer-1');
  const [answer]=state.events.splice(answerIndex,1); state.events.splice(state.events.findIndex(e=>e.id==='done-1'),0,answer);
  const changed=()=>listeners.forEach(listener=>listener({type:'changed'}));
  return {
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    async request(input:Request):Promise<Result>{
      if(input.type==='snapshot')return{snapshot:structuredClone(state)};
      if(input.type==='session.select'){state.selectedId=input.sessionId;changed();return{};}
      if(input.type==='preview.claim'){if(!previewResolve||previewClaimed||input.ticket!==ticket||input.sessionId!==state.selectedId)throw new Error('样例请求已失效');previewClaimed=true;return{preview:{ticket,url:'https://example.com/'}};}
      if(input.type==='preview.complete'){if(!previewResolve||!previewClaimed||input.ticket!==ticket)throw new Error('样例请求已失效');const done=previewResolve;previewResolve=undefined;done(input.accepted);return{};}
      if(input.type==='files.read' || input.type==='files.list') {
        if(input.sessionId !== 'conversation-fixture') throw new Error('QA 会话没有内存目录权限');
        if(input.type==='files.list') {
          if(input.path) throw new Error('QA 仅提供内存根目录');
          return {entries:[...files].map(([path,text])=>({path,name:path,kind:'file',size:new TextEncoder().encode(text).length}))};
        }
        const text=files.get(input.path); if(text===undefined) throw new Error('此内存样例文件不存在；未访问磁盘');
        return {file:{path:input.path,kind:input.path.endsWith('.md')?'markdown':'text',text,size:new TextEncoder().encode(text).length}};
      }
      if(input.type==='run.cancel'){
        if(input.sessionId!=='conversation-fixture'||input.runId!==state.sessions[0].activeRunId) throw new Error('没有匹配的样例任务');
        state.events.push(event(crypto.randomUUID(),'approval-fixture','cancelled',{reason:'样例已取消；未执行真实操作'})); delete state.sessions[0].activeRunId;changed();return{};
      }
      if(input.type==='run.approve'){
        if(input.sessionId!=='conversation-fixture'||input.runId!==state.sessions[0].activeRunId||input.callId!=='call-fixture'||approvalPending) throw new Error('没有匹配的待审批样例');
        approvalPending=true;
        await new Promise(resolve=>setTimeout(resolve,approvalDelay));
        if(!state.sessions[0].activeRunId) return{};
        let received=false;
        if(web&&input.allowed) received=await new Promise<boolean>(resolve=>{const timer=setTimeout(()=>{previewResolve=undefined;resolve(false);},5000);previewResolve=accepted=>{clearTimeout(timer);resolve(accepted);};listeners.forEach(listener=>listener({type:'preview.open',ticket,sessionId:'conversation-fixture'}));});
        if(!state.sessions[0].activeRunId)return{};
        if(input.allowed&&!web) files.set('summary.md','# 内存摘要样例\n\n审批仅改变 QA 内存；没有写入磁盘。');
        state.events.push(event(crypto.randomUUID(),'approval-fixture','approval_resolved',{callId:'call-fixture',allowed:input.allowed}));
        state.events.push(event(crypto.randomUUID(),'approval-fixture','tool_result',{callId:'call-fixture',denied:!input.allowed,isError:web&&input.allowed&&!received,text:!input.allowed?'已拒绝；没有打开或写入':web?(received?'标签打开请求已接收；未读取网页，加载状态请查看右侧':'界面未确认打开请求'):'内存样例已更新；没有写入磁盘'}));
        state.events.push(event(crypto.randomUUID(),'approval-fixture','completed',{}));delete state.sessions[0].activeRunId;changed();return{};
      }
      if(input.type==='model.list')return{models:[{id:'offline-test',name:'离线验证（开发）'}]};
      if(input.type==='model.save'){state.config={...input.config};changed();return{};}
      throw new Error('此工作台为开发样例：不连接 Host、模型或真实文件，请返回组件样例检查项目与文件交互。');
    },
  };
}
export function QAWorkbench({web=false}:{web?:boolean}){const[bridge]=useState(()=>fixture(1800,web));return <App initialClient={bridge}/>;}
