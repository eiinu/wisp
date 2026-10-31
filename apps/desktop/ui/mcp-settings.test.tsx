// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {McpSettings} from './mcp-settings.js';
import type {McpServerInfo} from '@wisp/core';
let element:HTMLDivElement,root:Root;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;element=document.createElement('div');document.body.append(element);root=createRoot(element);});
afterEach(async()=>{await act(()=>root.unmount());element.remove();});
const find=(label:string)=>Array.from(element.querySelectorAll('button')).find(b=>b.textContent===label)!;
const click=async(label:string)=>{await act(()=>find(label).click());};
async function text(input:HTMLInputElement|HTMLTextAreaElement,value:string){await act(()=>{Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
const server:McpServerInfo={id:'fixture-id',name:'测试服务',command:'node',args:['/fixture/server.js'],state:'disabled',tools:[],envNames:['TOKEN'],envStorage:'secure'};
it('adds disabled config with argument arrays, masks env and cancels without request',async()=>{
 const request=vi.fn(async()=>({})),dirty=vi.fn();await act(()=>root.render(<McpSettings servers={[]} connected request={request} onDirty={dirty}/>));
 await click('添加本地 MCP');expect(dirty).toHaveBeenLastCalledWith(true);await click('取消编辑');expect(request).not.toHaveBeenCalled();
 await click('添加本地 MCP');const inputs=element.querySelectorAll('form input');await text(inputs[0] as HTMLInputElement,'我的服务');await text(inputs[1] as HTMLInputElement,'node');await text(element.querySelector('textarea')!,'["server.js","literal ; $(text)"]');
 await click('添加环境变量');const secret=element.querySelector<HTMLInputElement>('[aria-label="变量 1 值"]')!;expect(secret.type).toBe('password');await text(element.querySelector('[aria-label="变量 1 名称"]')!,'TOKEN');await text(secret,'fake-secret');
 await act(()=>element.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(request).toHaveBeenCalledWith(expect.objectContaining({type:'mcp.save',config:expect.objectContaining({args:['server.js','literal ; $(text)']}),env:{TOKEN:'fake-secret'},rememberEnv:true}));expect(request).toHaveBeenCalledTimes(1);expect(element.querySelector('form')).toBeNull();expect(element.innerHTML).not.toContain('fake-secret');
});
it('requires explicit activation confirmation, guards duplicate click and never re-displays saved secrets',async()=>{
 let finish!:()=>void;const request=vi.fn(()=>new Promise<{}>(resolve=>{finish=()=>resolve({});}));
 await act(()=>root.render(<McpSettings servers={[server]} connected request={request} onDirty={()=>{}}/>));
 await click('激活 测试服务');expect(request).not.toHaveBeenCalled();expect(element.textContent).toContain('不受项目目录授权限制');await click('取消');expect(request).not.toHaveBeenCalled();
 await click('激活 测试服务');await click('信任并激活');expect(request).toHaveBeenCalledTimes(1);expect(request).toHaveBeenCalledWith({type:'mcp.activate',id:server.id,confirmed:true});
 await act(()=>finish());await click('编辑 测试服务');expect(element.querySelector('input[type=password]')).toBeNull();expect(element.textContent).toContain('保留变量：TOKEN');await click('取消编辑');
 await click('删除 测试服务');expect(element.textContent).toContain('不会删除服务程序');await click('取消');expect(request).toHaveBeenCalledTimes(1);
});
it('shows real failure and allows disabling while connecting; disconnected controls cannot launch',async()=>{
 const request=vi.fn(async()=>{throw new Error('test failure');});await act(()=>root.render(<McpSettings servers={[{...server,state:'connecting'}]} connected request={request} onDirty={()=>{}}/>));await click('禁用 测试服务');expect(request).toHaveBeenCalledWith({type:'mcp.disable',id:server.id});expect(element.textContent).toContain('禁用失败');
 await act(()=>root.render(<McpSettings servers={[server]} connected={false} request={request} onDirty={()=>{}}/>));expect(find('激活 测试服务').disabled).toBe(true);expect(find('添加本地 MCP').disabled).toBe(true);
});
it('restores cancelled activation/deletion focus without stealing focus after navigation',async()=>{
 const request=vi.fn(async()=>({}));await act(()=>root.render(<McpSettings servers={[server]} connected request={request} onDirty={()=>{}}/>));
 for(const action of ['激活 测试服务','删除 测试服务']){
  const trigger=find(action);trigger.focus();await click(action);expect(document.activeElement).toBe(find('取消'));
  await click('取消');expect(document.activeElement).toBe(trigger);
 }
 await click('激活 测试服务');await act(()=>find('取消').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(document.activeElement).toBe(find('激活 测试服务'));
 await click('删除 测试服务');const elsewhere=document.createElement('button');document.body.append(elsewhere);elsewhere.focus();await click('取消');expect(document.activeElement).toBe(elsewhere);elsewhere.remove();
 await click('激活 测试服务');element.hidden=true;await click('取消');expect(document.activeElement).not.toBe(find('激活 测试服务'));element.hidden=false;
 expect(request).not.toHaveBeenCalled();
});
