import React,{useRef,useState,useId} from 'react';
import {questionnaireSchema,validateQuestionResponse,type Questionnaire,type QuestionResponse,type QuestionAnswer,type Request,type Result,type RunEvent} from '@wisp/core';
import './questionnaire.css';
/** Shared visual shell only. Authorization and clarification keep separate handlers and tickets. */
export function InteractionCard({title,children,className=''}:{title:string;children:React.ReactNode;className?:string}) {
 return <section className={`interaction-card ${className}`} aria-label={title}><h3>{title}</h3>{children}</section>;
}
export function QuestionnaireForm({form,disabled=false,onSubmit}:{form:Questionnaire;disabled?:boolean;onSubmit(response:QuestionResponse):Promise<void>}){
 const uid=useId(),[index,setIndex]=useState(0),[answers,setAnswers]=useState<QuestionAnswer[]>(()=>form.questions.map(q=>({questionId:q.id,optionIds:[],text:''}))),[custom,setCustom]=useState<string[]>([]),[pending,setPending]=useState(false),[sent,setSent]=useState<QuestionResponse>(),[error,setError]=useState('');
 const lock=useRef(false),heading=useRef<HTMLHeadingElement>(null),q=form.questions[index],a=answers[index];
 const update=(change:Partial<QuestionAnswer>)=>{setError('');setAnswers(items=>items.map((v,i)=>i===index?{...v,...change}:v));};
 const navigate=(next:number)=>{setIndex(next);setError('');requestAnimationFrame(()=>heading.current?.focus());};
 const submit=async(response:QuestionResponse)=>{
  if(lock.current||disabled||sent)return;
  try{validateQuestionResponse(form,response);}catch(e){setError(e instanceof Error?e.message:'请检查答案');const first=form.questions.findIndex((q,i)=>q.required&&!answers[i].text.trim()&&!answers[i].optionIds.length);if(first>=0)navigate(first);setError('请完成所有必填题');return;}
  lock.current=true;setPending(true);setError('');
  try{await onSubmit(response);setSent(response);}catch(e){setError(e instanceof Error?e.message:'提交失败，请重试');}finally{lock.current=false;setPending(false);}
 };
 if(sent)return <QuestionAnswers form={form} response={sent}/>;
 return <InteractionCard title={form.title} className="questionnaire"><p className="question-note">补充任务细节，不代表批准任何操作。请勿填写密码、API Key 或其他秘密；凭据请在设置中填写。</p>
 <form onSubmit={e=>{e.preventDefault();void submit({status:'answered',answers});}}>
 <div className="question-progress" role="status">第 {index+1} / {form.questions.length} 题 · 已填写 {answers.filter(a=>a.optionIds.length||a.text.trim()).length} 题</div>
 <h4 tabIndex={-1} ref={heading} id={`${uid}-title`}>{q.title} <small>{q.required?'必填':'可跳过'}{q.type==='multiple'?' · 可多选':''}</small></h4>
 <fieldset disabled={disabled||pending} aria-labelledby={`${uid}-title`}>
 {q.options?.map(option=><label className="question-option" key={option.id}><input type={q.type==='multiple'?'checkbox':'radio'} name={`${uid}-${q.id}`} value={option.id} checked={a.optionIds.includes(option.id)} onChange={e=>{if(q.type==='single'){setCustom(v=>v.filter(id=>id!==q.id));update({optionIds:[option.id],text:''});}else update({optionIds:e.target.checked?[...a.optionIds,option.id]:a.optionIds.filter(id=>id!==option.id)});}}/><span>{option.label}{option.description&&<small>{option.description}</small>}</span></label>)}
 {q.type!=='text'&&q.allowCustom&&<label className="question-option"><input type={q.type==='multiple'?'checkbox':'radio'} name={`${uid}-${q.id}`} checked={custom.includes(q.id)} onChange={e=>{setCustom(v=>e.target.checked?[...v.filter(id=>id!==q.id),q.id]:v.filter(id=>id!==q.id));update({text:'',...(q.type==='single'?{optionIds:[]}:{})});}}/><span>自定义答案</span></label>}
 {(q.type==='text'||custom.includes(q.id))&&<label className="question-text">{q.type==='text'?'你的回答':'自定义内容'}<textarea aria-label={`${q.title}：${q.type==='text'?'你的回答':'自定义内容'}`} maxLength={4000} value={a.text} onChange={e=>update({text:e.target.value})}/></label>}
 {q.type!=='text'&&!q.required&&<button type="button" onClick={()=>{setCustom(v=>v.filter(id=>id!==q.id));update({optionIds:[],text:''});}}>清除此题选择</button>}
 </fieldset>
 {error&&<p role="alert">{error}</p>}
 <div className="interaction-actions"><button type="button" disabled={disabled||pending} onClick={()=>void submit({status:'cancelled'})}>暂不回答</button><span className="question-pagination"><button type="button" disabled={pending||index===0} onClick={()=>navigate(index-1)}>上一题</button>{index<form.questions.length-1?<button type="button" disabled={pending} onClick={()=>navigate(index+1)}>下一题</button>:<button type="submit" className="primary" disabled={disabled||pending}>{pending?'正在提交…':'提交回答'}</button>}</span></div>
 </form></InteractionCard>;
}
function QuestionAnswers({form,response}:{form:Questionnaire;response:QuestionResponse}){
 return <InteractionCard title={response.status==='cancelled'?'已暂不回答':form.title} className="questionnaire answered"><p role="status">{response.status==='cancelled'?'已告知 AI 暂不回答。没有批准任何操作。':'回答已提交 · 不代表操作授权'}</p>{response.status==='answered'&&<dl>{form.questions.map(q=>{const a=response.answers.find(a=>a.questionId===q.id);return <React.Fragment key={q.id}><dt>{q.title}</dt><dd>{[...(a?.optionIds.map(id=>q.options?.find(o=>o.id===id)?.label)??[]),a?.text].filter(Boolean).join('、')||'未填写'}</dd></React.Fragment>;})}</dl>}</InteractionCard>;
}
export function RunQuestions({events,ended,connected,request}:{events:RunEvent[];ended:boolean;connected:boolean;request(input:Request):Promise<Result>}){
 const seen=new Set<string>();
 return <>{events.filter(e=>e.type==='question_requested').map(e=>{
  const ticket=String(e.data.ticket);if(seen.has(ticket))return null;seen.add(ticket);
  const parsed=questionnaireSchema.safeParse(e.data.questionnaire);if(!parsed.success)return <p role="alert" key={e.id}>问答内容无效，请取消任务后重试。</p>;
  const resolved=events.find(r=>r.type==='question_resolved'&&r.data.ticket===ticket&&r.runId===e.runId&&r.sessionId===e.sessionId);
  if(resolved){try{return <QuestionAnswers key={ticket} form={parsed.data} response={validateQuestionResponse(parsed.data,resolved.data.response)}/>;}catch{return <p key={ticket}>历史答案无法显示</p>;}}
  if(ended)return <InteractionCard key={ticket} title={parsed.data.title}><p>任务已结束，此问答不可继续提交。没有重放回答。</p></InteractionCard>;
  return <QuestionnaireForm key={ticket} form={parsed.data} disabled={!connected} onSubmit={async response=>{if(!e.sessionId)throw new Error('问答缺少会话信息');await request({type:'run.answer',sessionId:e.sessionId,runId:e.runId,ticket,response});}}/>;
 })}</>;
}
