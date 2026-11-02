// @vitest-environment jsdom
import React,{act,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {SkillSettings,SkillPicker,SkillActivity} from './skills.js';
import {fixture} from './qa-workbench.js';
import {App} from './app.js';
import type {SkillInfo,RunEvent} from '@wisp/core';
let container:HTMLDivElement,root:Root;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement('div');document.body.append(container);root=createRoot(container);HTMLElement.prototype.scrollIntoView=vi.fn();vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});});
afterEach(async()=>{await act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
const button=(text:string)=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent?.startsWith(text))!;
const skills:SkillInfo[]=Array.from({length:4},(_,i)=>({id:String(i),name:'test-'+i,description:'这是用于检查很长描述的技能材料。'.repeat(30),source:'/fixture/test-'+i,version:'abc',enabled:true,warnings:[]}));
it('adds only a chosen folder; cancel does not register, pending double click is blocked and errors are visible',async()=>{
 let resolve!:(value:string|undefined)=>void;const choose=vi.fn(()=>new Promise<string|undefined>(r=>{resolve=r;})),request=vi.fn(async()=>({}));
 await act(()=>root.render(<SkillSettings skills={[]} connected request={request} chooseDirectory={choose}/>));
 await act(()=>{button('添加').focus();button('添加').click();button('添加').click();});expect(choose).toHaveBeenCalledTimes(1);expect(button('添加').getAttribute('aria-disabled')).toBe('true');await act(()=>resolve(undefined));expect(request).not.toHaveBeenCalled();expect(document.activeElement).toBe(button('添加'));
 await act(()=>button('添加').click());await act(()=>resolve('/selected/skill'));expect(request).toHaveBeenCalledWith({type:'skills.add',path:'/selected/skill',confirmed:true});
 await act(()=>root.render(<SkillSettings skills={[{...skills[0],error:'正文无效',enabled:false}]} connected request={request} chooseDirectory={choose}/>));expect(button('启用').disabled).toBe(true);expect(container.querySelector('[role=alert]')?.textContent).toContain('正文无效');await act(()=>button('刷新').click());expect(request).toHaveBeenLastCalledWith({type:'skills.refresh',id:'0'});
 await act(()=>button('移除').click());expect(request).toHaveBeenLastCalledWith({type:'skills.remove',id:'0'});
});
it('keeps three-selection bound, allows unselecting and hides disabled skills; renders history without side effects',async()=>{
 function Picker(){const[selected,setSelected]=useState<string[]>([]);return <SkillPicker skills={[...skills,{...skills[0],id:'off',enabled:false}]} selected={selected} onChange={setSelected} disabled={false}/>;}
 await act(()=>root.render(<Picker/>));const inputs=Array.from(container.querySelectorAll('input'));expect(inputs).toHaveLength(4);for(const field of inputs.slice(0,3))await act(()=>field.click());expect(inputs[3].disabled).toBe(true);await act(()=>inputs[1].click());expect(inputs[3].disabled).toBe(false);
 const event={id:'load',runId:'run',sessionId:'s',type:'skill_loaded',data:{name:'test',source:'/selected/skill',version:'abc'}} as unknown as RunEvent;await act(()=>root.render(<SkillActivity events={[event]}/>));expect(container.textContent).toContain('/selected/skill');expect(container.textContent).toContain('已加载 1 个技能');
});
it('real App settings and composer send explicit selected IDs through the bridge; QA is memory only',async()=>{
 const bridge=fixture(0,false,'skills'),request=vi.spyOn(bridge,'request');await bridge.request({type:'skills.add',path:'/QA-memory-only/review-notes',confirmed:true});const state=(await bridge.request({type:'snapshot'})).snapshot!;const id=state.skills![0].id;await bridge.request({type:'skills.enable',id,enabled:true});
 await act(async()=>root.render(<App initialClient={bridge}/>));
 const checkbox=container.querySelector('.skill-picker input') as HTMLInputElement;expect(checkbox).toBeTruthy();await act(()=>checkbox.click());const input=container.querySelector('textarea[aria-label="消息"]')!;
 await act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'测试技能');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(()=>container.querySelector<HTMLButtonElement>('button[aria-label="发送"]')!.click());
 expect(request.mock.calls.some(([r])=>r.type==='run.start'&&r.skillIds?.[0]===id)).toBe(true);expect(container.textContent).toContain('已加载 1 个技能');
});
it('host execution is off by default, explicit session opt-in is separate from enabling a skill and errors remain visible',async()=>{
 const request=vi.fn(async()=>({}));await act(()=>root.render(<SkillSettings skills={[]} connected request={request}/>));const field=container.querySelector<HTMLInputElement>('input[type=checkbox]')!;expect(field.checked).toBe(false);expect(container.textContent).toContain('没有 OS 沙箱');
 await act(()=>field.click());expect(request).toHaveBeenCalledExactlyOnceWith({type:'execution.configure',enabled:true,confirmed:true});expect(container.textContent).toContain('每次仍须');
 request.mockRejectedValueOnce(new Error('服务断开'));await act(()=>field.click());expect(container.querySelector('[role=alert]')?.textContent).toContain('服务断开');
});
it('QA installation registers disabled only after approval and execution artifact opens in actual preview tab without file authority',async()=>{
 const installer=fixture(0,false,'skill_install_package');await installer.request({type:'run.approve',sessionId:'conversation-fixture',runId:'approval-fixture',callId:'call-fixture',allowed:true});expect((await installer.request({type:'snapshot'})).snapshot?.skills?.[0].enabled).toBe(false);
 const bridge=fixture(0,false,'process_run_skill');await bridge.request({type:'run.approve',sessionId:'conversation-fixture',runId:'approval-fixture',callId:'call-fixture',allowed:true});await act(()=>root.render(<App initialClient={bridge}/>));await act(()=>button('预览 report.md').click());expect(container.querySelector('.execution-artifact')?.textContent).toContain('不是磁盘文件');expect(container.querySelector('[role=tab][aria-selected=true]')?.textContent).toContain('report.md');
});
