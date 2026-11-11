// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { WorkbenchBridge, Snapshot, RunEvent, Notice, Result } from '@wisp/core';
import { App } from './app.js';
const { parses } = vi.hoisted(() => ({parses:vi.fn()}));
vi.mock('react-markdown',async original => {
 const actual=await original<typeof import('react-markdown')>();
 return {...actual,default:(props:React.ComponentProps<typeof actual.default>)=>{parses();return <actual.default {...props}/>;}};
});
let container:HTMLDivElement,root:Root;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});HTMLElement.prototype.scrollIntoView=vi.fn();container=document.createElement('div');document.body.append(container);root=createRoot(container);parses.mockClear();});
afterEach(async()=>{await act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
const event=(id:string,text=id):RunEvent=>({version:1,id,sessionId:'one',runId:'run',at:'',type:'assistant',data:{step:0,text}});
const state=(events:RunEvent[]):Snapshot=>({sessions:[{id:'one',title:'First',createdAt:'',updatedAt:''}],selectedId:'one',events,keyPresent:false,browserConnected:false,config:{provider:'offline',model:'offline',baseUrl:''}});
function deferred(){let resolve!:(r:Result)=>void;const promise=new Promise<Result>(r=>resolve=r);return {promise,resolve};}
it('does not reparse unchanged history when opening/returning from settings or editing a draft',async()=>{
 // 25k background events exercise the history merge without conflating it with 25k DOM nodes or IPC serialization.
 const background=Array.from({length:25000},(_,i)=>({...event(`background-${i}`),sessionId:'background'}));
 const snapshot=state([...background,event('answer','# Stable answer\n\n**bold**')]);
 const bridge:WorkbenchBridge={request:vi.fn(async input=>input.type==='snapshot'?{snapshot}:{}),subscribe:()=>()=>{}};
 await act(()=>root.render(<App initialClient={bridge}/>));expect(parses).toHaveBeenCalledTimes(1);
 const input=container.querySelector<HTMLTextAreaElement>('textarea[aria-label="消息"]')!;
 await act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'draft');input.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(input.value).toBe('draft');expect(parses).toHaveBeenCalledTimes(1);
 await act(()=>container.querySelector<HTMLButtonElement>('.sidebar-bottom button')!.click());
 expect(container.querySelector('.settings-page')).not.toBeNull();expect(parses).toHaveBeenCalledTimes(1);
 await act(()=>container.querySelector<HTMLButtonElement>('.settings-back')!.click());
 expect(container.querySelector('.settings-page')).toBeNull();expect(input.value).toBe('draft');expect(parses).toHaveBeenCalledTimes(1);
});
it('keeps streamed notices during refresh and rejects stale responses from consecutive changed notifications',async()=>{
 let notify!:(notice:Notice)=>void;const requests:ReturnType<typeof deferred>[]=[];
 const bridge:WorkbenchBridge={request:vi.fn(input=>{if(input.type!=='snapshot')return Promise.resolve({});const request=deferred();requests.push(request);return request.promise;}),subscribe:callback=>{notify=callback;return ()=>{};}};
 await act(()=>root.render(<App initialClient={bridge}/>));
 await act(()=>requests[0].resolve({snapshot:state([event('initial','initial answer')])}));
 await act(()=>{notify({type:'changed'});notify({type:'changed'});notify({type:'event',event:{...event('stream','streamed answer'),runId:'stream'}});});
 await act(()=>requests[2].resolve({snapshot:state([event('initial','latest snapshot answer')])}));
 await act(()=>requests[1].resolve({snapshot:state([event('stale','STALE answer')])}));
 expect(container.textContent).toContain('latest snapshot answer');expect(container.textContent).toContain('streamed answer');expect(container.textContent).not.toContain('STALE answer');
});
it('creates and archives a conversation with a large background history and returns to the preserved conversation',async()=>{
 let snapshot=state([...Array.from({length:25000},(_,i)=>({...event(`background-${i}`),sessionId:'background'})),event('answer','Preserved answer')]);
 let notify!:(notice:Notice)=>void;
 const bridge:WorkbenchBridge={subscribe:callback=>{notify=callback;return ()=>{};},request:vi.fn(async input=>{
  if(input.type==='snapshot')return {snapshot};
  if(input.type==='session.create'){
   snapshot={...snapshot,selectedId:'new',sessions:[...snapshot.sessions,{id:'new',title:'新会话',createdAt:'',updatedAt:''}]};notify({type:'changed'});return {sessionId:'new'};
  }
  if(input.type==='session.archive'){
   snapshot={...snapshot,sessions:snapshot.sessions.map(s=>s.id===input.sessionId?{...s,archivedAt:'2026-11-11'}:s)};notify({type:'changed'});
  }
  return {};
 })};
 await act(()=>root.render(<App initialClient={bridge}/>));expect(container.querySelector('.messages')?.textContent).toContain('Preserved answer');
 await act(()=>container.querySelector<HTMLButtonElement>('.new-chat')!.click());expect(container.querySelector('.session.selected')?.textContent).toBe('新会话');
 await act(()=>container.querySelector<HTMLButtonElement>('button[aria-label="归档对话 新会话"]')!.click());
 expect(container.querySelector('.session.selected')?.textContent).toBe('First');expect(container.querySelector('.messages')?.textContent).toContain('Preserved answer');
 expect(snapshot.events).toHaveLength(25001);
});
