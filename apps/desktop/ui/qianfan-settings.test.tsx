// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {SettingsPage} from './settings-page.js';
import {QIANFAN_MODEL,QIANFAN_BASE_URL,type Request,type Snapshot} from '@wisp/core';
it('selects the native Qianfan preset, clears previous key input and saves/query presets without claiming API validation',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 const snapshot:Snapshot={sessions:[],events:[],keyPresent:true,credential:{storage:'secure',saved:true},browserConnected:false,config:{provider:'deepseek',model:'deepseek-flash',baseUrl:'https://api.deepseek.com'}};
 const request=vi.fn(async(input:Request)=>input.type==='model.list'?{models:[{id:QIANFAN_MODEL,name:'文心 5.5 Flash Preview'}]}:{});
 const input=async(element:HTMLInputElement,text:string)=>act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,text);element.dispatchEvent(new Event('input',{bubbles:true}));});
 try{
  await act(()=>root.render(<SettingsPage snapshot={snapshot} connected request={request} onBack={()=>{}} onConnect={async()=>{}} onRetry={()=>{}}/>));
  await input(container.querySelector('input[type=password]')!,'FAKE_DEEPSEEK_INPUT');
  await act(()=>{const provider=container.querySelector('select')!;provider.value='qianfan';provider.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(container.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe('');expect(container.querySelector<HTMLInputElement>('fieldset[aria-busy] input[type=checkbox]')?.checked).toBe(true);expect(container.textContent).not.toContain('思考强度');expect(Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='删除 Key')).toBeUndefined();
  expect(Array.from(container.querySelectorAll('input')).some(i=>i.value===QIANFAN_MODEL)).toBe(true);expect(container.querySelector<HTMLInputElement>('input[type=url]')!.value).toBe(QIANFAN_BASE_URL);expect(container.textContent).toContain('分别加密保存');
  await input(container.querySelector('input[type=password]')!,'FAKE_QIANFAN_INPUT');await act(()=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='保存并查看预置模型')!.click());
  expect(request.mock.calls.map(([r])=>r.type)).toEqual(['model.save','model.list']);expect(request.mock.calls[0][0]).toEqual({type:'model.save',config:{provider:'qianfan',model:QIANFAN_MODEL,baseUrl:QIANFAN_BASE_URL},rememberKey:true,apiKey:'FAKE_QIANFAN_INPUT'});
  expect(container.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe('');expect(container.textContent).toContain('尚未验证 Key 或服务权限');
 }finally{await act(()=>root.unmount());container.remove();}
});
it('offers explicit Qianfan session storage when no OS vault is available',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const container=document.createElement('div');document.body.append(container);const root=createRoot(container),request=vi.fn(async()=>({}));
 const snapshot:Snapshot={sessions:[],events:[],keyPresent:false,browserConnected:false,credential:{storage:'session',saved:false},config:{provider:'qianfan',model:QIANFAN_MODEL,baseUrl:QIANFAN_BASE_URL}};
 try{
  await act(()=>root.render(<SettingsPage snapshot={snapshot} connected request={request} onBack={()=>{}} onConnect={async()=>{}} onRetry={()=>{}}/>));
  expect(container.querySelector('fieldset[aria-busy] input[type=checkbox]')).toBeNull();expect(container.textContent).toContain('不提供系统钥匙串');
  await act(()=>{const field=container.querySelector<HTMLInputElement>('input[type=password]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,'FAKE_SESSION');field.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(()=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='保存设置')!.click());
  expect(request).toHaveBeenCalledWith({type:'model.save',config:snapshot.config,rememberKey:false,apiKey:'FAKE_SESSION'});
 }finally{await act(()=>root.unmount());container.remove();}
});
