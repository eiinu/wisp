/** Development-only fixture for the real App, imported exclusively by qa.html. */
import React, { useState } from 'react';
import type { Notice, Request, Result, RunEvent, Snapshot, WorkbenchBridge } from '@wisp/core';
import { App } from './app.js';

function fixture(): WorkbenchBridge {
  const listeners = new Set<(notice: Notice) => void>();
  const event = (id: string, runId: string, type: RunEvent['type'], data: Record<string, unknown>): RunEvent => ({ version: 1, id, sessionId: 'conversation-fixture', runId, type, at: '2026-10-31T00:00:00Z', data });
  const state: Snapshot = {
    sessions: [{id:'conversation-fixture',title:'整理研究资料（交互样例）',createdAt:'',updatedAt:'',activeRunId:'approval-fixture'},{id:'empty-fixture',title:'空白对话（样例）',createdAt:'',updatedAt:''}], selectedId:'conversation-fixture',
    keyPresent:false,browserConnected:false,config:{provider:'offline',model:'offline-test',baseUrl:''},
    events:[
      event('start-1','completed-fixture','started',{prompt:'帮我整理本周的研究笔记，并总结下一步。'}),
      event('answer-1','completed-fixture','assistant',{text:'## 本周进展\n\n这是一段**明确标注的组件测试内容**，不是模型生成结果。\n\n- 已整理资料与关键结论\n- 下一步：核对来源并补充实验\n\n行内公式 $a+b=c$。\n\n```typescript\nconst notes = ["观察", "结论"];\nconsole.log(notes);\n```\n\n[查看链接确认样例](https://example.com)\n\n'+Array.from({length:6},(_,i)=>`第 ${i+1} 段：长内容用于检查阅读宽度、滚动与复制操作。`).join('\n\n')}),
      event('done-1','completed-fixture','completed',{}),
      event('start-2','approval-fixture','started',{prompt:'把摘要保存为笔记。'}),
      event('answer-2','approval-fixture','assistant',{text:'以下为审批组件样例。批准或拒绝只改变页面内存，不会写入文件。'}),
      event('request-2','approval-fixture','tool_requested',{id:'call-fixture',name:'files_write',args:{path:'summary.md',content:'# 测试摘要'}}),
      event('approval-2','approval-fixture','approval_requested',{id:'call-fixture',name:'files_write',description:'测试审批：不会执行真实文件操作。',args:{path:'summary.md',content:'# 测试摘要'}}),
    ],
  };
  const changed=()=>listeners.forEach(listener=>listener({type:'changed'}));
  return {
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    async request(input:Request):Promise<Result>{
      if(input.type==='snapshot')return{snapshot:structuredClone(state)};
      if(input.type==='session.select'){state.selectedId=input.sessionId;changed();return{};}
      if(input.type==='run.approve'||input.type==='run.cancel'){
        state.events.push(event(crypto.randomUUID(),'approval-fixture',input.type==='run.cancel'?'cancelled':'completed',{text:'样例状态更新；没有执行任务'}));delete state.sessions[0].activeRunId;changed();return{};
      }
      if(input.type==='model.save'){state.config={...input.config};changed();return{};}
      throw new Error('此工作台为开发样例：不连接 Host、模型或真实文件，请返回组件样例检查项目与文件交互。');
    },
  };
}
export function QAWorkbench(){const[bridge]=useState(fixture);return <App initialClient={bridge}/>;}
