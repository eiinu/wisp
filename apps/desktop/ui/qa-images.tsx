/** UI-only in-memory image fixture. No Host, disk write or model request. */
import React,{useState} from 'react';
import {App} from './app.js';
import type {ChatImage,Notice,Snapshot,WorkbenchBridge} from '@wisp/core';
function fixture():WorkbenchBridge{
 const sessions=['one','two'].map(title=>({id:crypto.randomUUID(),title:`图片 QA ${title}`,createdAt:'',updatedAt:''}));
 const state:Snapshot={sessions,selectedId:sessions[0].id,events:[],config:{provider:'deepseek',model:'deepseek-flash',baseUrl:'https://qa.invalid'},imageInputSupported:true,keyPresent:true,browserConnected:false};
 const listeners=new Set<(n:Notice)=>void>(),images=new Map<string,{sessionId:string;image:ChatImage;url:string}>();
 const changed=()=>listeners.forEach(l=>l({type:'changed'}));
 return{subscribe:l=>{listeners.add(l);return()=>listeners.delete(l);},async request(command){
  if(command.type==='snapshot')return{snapshot:structuredClone(state)};
  if(command.type==='model.list')return{models:[{id:'deepseek-flash',inputModalities:['text','image']},{id:'deepseek-v4-pro',inputModalities:['text']}]};
  if(command.type==='model.save'){state.config=command.config;state.imageInputSupported=command.config.model==='deepseek-flash';changed();return{};}
  if(command.type==='images.import'){const id=crypto.randomUUID(),image:ChatImage={id,name:command.name,mime:'image/png',size:command.data.length,width:1,height:1,sha256:'a'.repeat(64)};images.set(id,{sessionId:command.sessionId,image,url:`data:image/png;base64,${command.data}`});return{image};}
  if(command.type==='images.read'){const value=images.get(command.id);if(value?.sessionId!==command.sessionId)throw new Error('QA 图片不可用');return{image:value.image,imageDataUrl:value.url};}
  if(command.type==='session.select'){state.selectedId=command.sessionId;changed();return{};}
  if(command.type==='session.create'){const id=crypto.randomUUID();state.sessions.unshift({id,title:command.title,createdAt:'',updatedAt:''});state.selectedId=id;changed();return{sessionId:id};}
  if(command.type==='session.rename'){const s=state.sessions.find(s=>s.id===command.sessionId);if(s)s.title=command.title;changed();return{};}
  if(command.type==='run.start'){
   const s=state.sessions.find(s=>s.id===command.sessionId)!;if(s.activeRunId)throw new Error('QA 正在运行');const runId=crypto.randomUUID();s.activeRunId=runId;
   const event=(type:'started'|'assistant'|'completed',data:Record<string,unknown>)=>state.events.push({version:1,id:crypto.randomUUID(),sessionId:s.id,runId,at:new Date().toISOString(),type,data});
   event('started',{prompt:command.prompt,images:(command.imageIds??[]).map(id=>images.get(id)!.image)});changed();
   setTimeout(()=>{if(s.activeRunId!==runId)return;event('assistant',{text:'QA 内存回显：图片没有发送给模型，也没有写入磁盘；此场景不验证格式解码和真实 API。'});event('completed',{});delete s.activeRunId;changed();},1500);return{};
  }
  if(command.type==='run.cancel'){const s=state.sessions.find(s=>s.id===command.sessionId)!;if(s.activeRunId===command.runId){state.events.push({version:1,id:crypto.randomUUID(),sessionId:s.id,runId:command.runId,at:'',type:'cancelled',data:{reason:'QA 已取消；没有调用模型'}});delete s.activeRunId;changed();}return{};}
  throw new Error('此 QA 样例仅演示图片 UI');
 }};
}
export function ImageQA(){const[bridge]=useState(fixture);return <div className="qa-shell"><div className="qa-banner">图片 QA · 仅内存 UI 样例，不验证图片解码、不存磁盘、不发送模型。刷新即清空。</div><div className="qa-workbench"><App initialClient={bridge}/></div></div>;}
