import { SkillActivity } from './skills.js';
import React,{useRef,useState} from 'react';
import type {Request,Result,RunEvent} from '@wisp/core';
import {ToolActivity,toolLabel} from './tool-activity.js';
import {InteractionCard,RunQuestions} from './questionnaire.js';
import {Markdown} from './markdown.js';
import {groupExecution} from './tool-groups.js';
import './subagent-activity.css';
export function SubagentActivity({events,parentRunId,sessionId,connected,request,openFile,canPreview}:{events:RunEvent[];parentRunId:string;sessionId:string;connected:boolean;request(input:Request):Promise<Result>;openFile(path:string):void;canPreview:boolean}) {
 const scoped=[...new Map(events.filter(e=>e.sessionId===sessionId&&e.parentRunId===parentRunId).map(e=>[e.id,e])).values()];
 return <div className="subagents" aria-label="子任务">{[...new Set(scoped.map(e=>e.runId))].map(id=><Subtask key={id} events={scoped.filter(e=>e.runId===id)} connected={connected} request={request} openFile={openFile} canPreview={canPreview}/>)}</div>;
}
function Subtask({events,connected,request,openFile,canPreview}:{events:RunEvent[];connected:boolean;request(input:Request):Promise<Result>;openFile(path:string):void;canPreview:boolean}) {
 const [error,setError]=useState(''),[pending,setPending]=useState<string[]>([]),locks=useRef(new Set<string>());
 const first=events[0],terminal=events.findLast(e=>['completed','failed','cancelled'].includes(e.type));
 const approvals=events.filter(e=>e.type==='approval_requested'&&!events.some(n=>n.type==='approval_resolved'&&n.data.callId===e.data.id));
 const questions=events.some(e=>e.type==='question_requested'&&!events.some(n=>n.type==='question_resolved'&&n.data.ticket===e.data.ticket));
 const status=terminal?(({completed:'已完成',failed:'失败',cancelled:'已停止'} as Record<string,string>)[terminal.type]??'已结束'):approvals.length?'等待批准':questions?'等待回答':'运行中';
 const act=async(key:string,input:Request)=>{if(locks.current.has(key))return;locks.current.add(key);setPending([...locks.current]);setError('');try{await request(input);}catch(e){setError(e instanceof Error?e.message:'操作失败');}finally{locks.current.delete(key);setPending([...locks.current]);}};
 const title=first.taskTitle??'子任务';
 return <section className="subtask" aria-label={`子任务：${title}`}>
  <header><strong>{title}</strong><span role="status">{status}</span>{!terminal&&<button disabled={!connected||pending.includes('stop')} onClick={()=>void act('stop',{type:'run.cancel',sessionId:first.sessionId!,runId:first.runId})}>{pending.includes('stop')?'正在停止…':'停止'}</button>}</header>
  {error&&<p role="alert">{error}</p>}
  {terminal&&terminal.type!=='completed'&&<p className="file-status">{String(terminal.data.reason??'子任务已结束')}。已执行的外部操作不会撤销。</p>}
  <details className="subtask-process"><summary>查看任务与执行过程</summary><p className="subtask-prompt">{String(events.find(e=>e.type==='started')?.data.prompt??'')}</p><SkillActivity events={events}/><ToolActivity events={events} ended={!!terminal} canPreview={canPreview} openFile={openFile}/>{groupExecution(events).answers.map((round,i)=><Markdown key={i} text={round.text}/>)}</details>
  {/* Approval and clarification must remain visible even when process details collapse. */}
  {!terminal&&approvals.map(e=><InteractionCard key={e.id} title={`${title} · 操作授权`} className="approval"><strong>{toolLabel(String(e.data.name))}</strong><pre>{String(e.data.description??'')}</pre><pre>{JSON.stringify(e.data.args,null,2)}</pre><small>仅批准此子任务的一次调用；停止不撤销已经完成的操作。</small><div className="interaction-actions">{[true,false].map(allowed=><button key={String(allowed)} disabled={!connected||pending.includes(String(e.data.id))} onClick={()=>void act(String(e.data.id),{type:'run.approve',sessionId:first.sessionId!,runId:first.runId,callId:String(e.data.id),allowed})}>{allowed?'批准执行':'拒绝'}</button>)}</div></InteractionCard>)}
  <RunQuestions events={events} ended={!!terminal} connected={connected} request={request}/>
 </section>;
}
