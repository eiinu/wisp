// @vitest-environment jsdom
import React,{act,useState,useRef} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {ImagePicker,type DraftImage} from './chat-images.js';
import {App} from './app.js';
import type {Snapshot,Request,Notice,Result} from '@wisp/core';
let container:HTMLDivElement,root:Root;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});HTMLElement.prototype.scrollIntoView=vi.fn();container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
async function choose(files:File[]){const input=container.querySelector<HTMLInputElement>('input[type=file]')!;await act(async()=>{Object.defineProperty(input,'files',{configurable:true,value:files});input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,20));});}
const file=()=>new File(['fixture image bytes'],'test.png',{type:'image/png'});
it('selects multiple files, removes, enforces limits and handles clipboard without automatic send',async()=>{
 const error=vi.fn(),pending=vi.fn();function Harness(){const [images,set]=useState<DraftImage[]>([]),textarea=useRef<HTMLTextAreaElement>(null);return <><textarea ref={textarea}/><ImagePicker images={images} onChange={set} onError={error} onPending={pending} disabled={false} pasteTarget={textarea}/></>;}
 await act(()=>root.render(<Harness/>));await choose([file(),file()]);await vi.waitFor(async()=>{await act(async()=>{});await vi.waitFor(async()=>{await act(async()=>{});expect(container.querySelectorAll('img')).toHaveLength(2);});});await act(()=>container.querySelector<HTMLButtonElement>('button[aria-label^="移除图片"]')!.click());expect(container.querySelectorAll('img')).toHaveLength(1);
 await choose(Array.from({length:4},file));expect(error).toHaveBeenLastCalledWith('每次最多选择 4 张图片');expect(container.querySelectorAll('img')).toHaveLength(1);
 await choose([new File([new Uint8Array(10*1024*1024+1)],'large.png',{type:'image/png'})]);expect(error).toHaveBeenLastCalledWith('每张图片必须非空且不超过 10 MiB');
 await choose([new File(['bad'],'bad.svg',{type:'image/svg+xml'})]);expect(error).toHaveBeenLastCalledWith('请选择 JPEG、PNG、WebP 或 GIF 图片');
 await act(async()=>{const event=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{files:[file()]}});container.querySelector('textarea')!.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);await new Promise(r=>setTimeout(r,20));});await vi.waitFor(async()=>{await act(async()=>{});expect(container.querySelectorAll('img')).toHaveLength(2);});
 expect(pending).toHaveBeenLastCalledWith(false);
});
it('cancels unfinished file reads when switching draft components without late attachment insertion',async()=>{
 const change=vi.fn(),abort=vi.fn();let reader:any;
 vi.stubGlobal('FileReader',class{onload:any;onabort:any;result='data:image/png;base64,AAAA';readAsDataURL(){reader=this;}abort(){abort();this.onabort?.();}});
 await act(()=>root.render(<ImagePicker key="one" images={[]} onChange={change} onError={vi.fn()} onPending={vi.fn()} disabled={false} pasteTarget={{current:null}}/>));await choose([file()]);await act(()=>root.render(<ImagePicker key="two" images={[]} onChange={change} onError={vi.fn()} onPending={vi.fn()} disabled={false} pasteTarget={{current:null}}/>));await act(()=>reader.onload?.());expect(abort).toHaveBeenCalled();expect(change).not.toHaveBeenCalled();
});
it('keeps per-session image drafts, blocks nonvision and preserves failed-send draft then sends exactly once',async()=>{
 const state:Snapshot={sessions:['one','two'].map(id=>({id,title:`会话 ${id}`,createdAt:'',updatedAt:''})),selectedId:'one',events:[],keyPresent:true,browserConnected:false,config:{provider:'deepseek',model:'deepseek-v4-pro',baseUrl:'https://api.deepseek.com'},imageInputSupported:false};
 let emit!:(n:Notice)=>void,fail=true;
 const request=vi.fn(async(r:Request):Promise<Result>=>{if(r.type==='snapshot')return{snapshot:structuredClone(state)};if(r.type==='images.import')return{image:{id:'saved',name:r.name,mime:'image/png',size:1,width:1,height:1,sha256:'a'.repeat(64)}};if(r.type==='run.start'&&fail)throw new Error('模拟发送失败');return{};});
 await act(()=>root.render(<App initialClient={{request,subscribe:l=>{emit=l;return()=>{};}}}/>));await choose([file()]);await vi.waitFor(async()=>{await act(async()=>{});expect(container.querySelectorAll('.chat-images-picker img')).toHaveLength(1);});
 expect(container.querySelector<HTMLButtonElement>('[aria-label=发送]')!.disabled).toBe(true);expect(container.textContent).toContain('当前模型不支持图片');
 const button=(text:string)=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent?.includes(text))!;
 await act(()=>button('会话 two').click());expect(container.querySelectorAll('.chat-images-picker img')).toHaveLength(0);await act(()=>button('会话 one').click());expect(container.querySelectorAll('.chat-images-picker img')).toHaveLength(1);
 state.config!.model='deepseek-flash';state.imageInputSupported=true;await act(()=>emit({type:'changed'}));
 await act(()=>container.querySelector<HTMLButtonElement>('[aria-label=发送]')!.click());expect(container.textContent).toContain('模拟发送失败');expect(container.querySelectorAll('.chat-images-picker img')).toHaveLength(1);
 fail=false;await act(()=>{container.querySelector<HTMLButtonElement>('[aria-label=发送]')!.click();container.querySelector<HTMLButtonElement>('[aria-label=发送]')!.click();});
 expect(request.mock.calls.filter(([r])=>r.type==='run.start')).toHaveLength(2);expect(request.mock.calls.filter(([r])=>r.type==='images.import')).toHaveLength(1);expect(container.querySelectorAll('.chat-images-picker img')).toHaveLength(0);
});
