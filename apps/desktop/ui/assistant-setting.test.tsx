// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsPage } from './settings-page.js';
import type { Snapshot } from '@wisp/core';
let container: HTMLDivElement, root: Root;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(()=>root.unmount());container.remove();});
const visible=()=>container.querySelector('section:not([hidden])')!;
const button=(name:string)=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent===name)!;
async function change(value:string){const field=container.querySelector('textarea')!;await act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));});}
const state:Snapshot={assistantSetting:'原设定',sessions:[{id:'session',title:'test',createdAt:'',updatedAt:'',activeRunId:'running'}],events:[],keyPresent:false,browserConnected:false};
it('edits during a run, preserves draft across categories, confirms discard and saves once with feedback',async()=>{
  let finish!:()=>void;const request=vi.fn(()=>new Promise<{}>(resolve=>{finish=()=>resolve({});})),back=vi.fn();
  await act(()=>root.render(<SettingsPage initialSection="assistant" snapshot={state} connected request={request} onBack={back} onConnect={async()=>{}} onRetry={()=>{}}/>));
  expect(container.querySelector('textarea')!.value).toBe('原设定');
  await change('长中文设定'.repeat(1000));expect(container.querySelector('textarea')!.maxLength).toBe(12000);
  await act(()=>button('模型').click());await act(()=>button('助手设定').click());
  expect(container.querySelector('textarea')!.value).toHaveLength(5000);
  await act(()=>button('返回工作台').click());expect(container.querySelector('[role=alertdialog]')).not.toBeNull();expect(back).not.toHaveBeenCalled();
  await act(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  expect(container.querySelector('[role=alertdialog]')).toBeNull();
  await act(()=>{button('保存助手设定').focus();button('保存助手设定').click();button('保存助手设定').click();});
  expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0]).toEqual([{type:'assistant.save',text:'长中文设定'.repeat(1000)}]);
  expect(button('保存助手设定').disabled).toBe(true);
  await act(()=>finish());expect(visible().textContent).toContain('助手设定已保存，下次任务生效');expect(document.activeElement).toBe(button('保存助手设定'));
  await change('new');expect(visible().textContent).toContain('有未保存的更改');expect(visible().textContent).not.toContain('助手设定已保存');
  await act(()=>button('清空设定').click());expect(container.querySelector('textarea')!.value).toBe('');
  await act(()=>button('保存助手设定').click());expect(request.mock.calls.at(-1)).toEqual([{type:'assistant.save',text:''}]);await act(()=>finish());
  await act(()=>button('返回工作台').click());expect(back).toHaveBeenCalledTimes(1);
});
it('blocks saving while disconnected and retains draft after a Host error',async()=>{
  const request=vi.fn(async()=>{throw new Error('本机保存失败');});
  const render=(connected:boolean)=>root.render(<SettingsPage initialSection="assistant" snapshot={state} connected={connected} request={request} onBack={()=>{}} onConnect={async()=>{}} onRetry={()=>{}}/>);
  await act(()=>render(false));expect(button('保存助手设定').disabled).toBe(true);
  await act(()=>render(true));await change('keep me');await act(()=>button('保存助手设定').click());
  expect(visible().querySelector('[role=alert]')?.textContent).toBe('本机保存失败');expect(container.querySelector('textarea')!.value).toBe('keep me');
});
