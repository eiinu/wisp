// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Notice, Request, Result, Snapshot, WorkbenchBridge } from '@wisp/core';
import { App } from './app.js';

let container: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; HTMLElement.prototype.scrollIntoView = vi.fn(); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const snapshot = (): Snapshot => ({ sessions: ['one', 'two'].map(id => ({ id, title: `会话 ${id}`, createdAt: '2026-10-31', updatedAt: '2026-10-31' })), selectedId: 'one', events: [], keyPresent: false, browserConnected: false, config: { provider: 'offline', model: 'offline-test', baseUrl: '' } });
function client(state = snapshot()) {
  let notice!: (event: Notice) => void;
  const request = vi.fn(async (input: Request): Promise<Result> => input.type === 'snapshot' ? { snapshot: state } : {});
  const bridge: WorkbenchBridge = { request, subscribe: handler => { notice = handler; return vi.fn(); } };
  return { bridge, request, emit: (event: Notice) => notice(event) };
}
const button = (text: string) => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes(text))!;
const click = async (text: string) => { await act(() => button(text).click()); };
async function inputText(text: string) {
  const textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')!;
  await act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
}
it('keeps drafts separate while changing sessions and renders real Markdown for streamed content', async () => {
  const c = client(); await act(() => root.render(<App initialClient={c.bridge}/>));
  await inputText('第一份草稿'); await click('会话 two'); await inputText('第二份草稿'); await click('会话 one');
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="消息"]')?.value).toBe('第一份草稿');
  await act(() => c.emit({ type: 'event', event: { version: 1, id: 'event1', sessionId: 'one', runId: 'run1', type: 'assistant_delta', at: '', data: { step: 0, text: '# 流式标题\n\n**未闭合' } } }));
  expect(container.querySelector('.markdown h1')?.textContent).toBe('流式标题');
});
it('does not submit Enter when the model is unconfigured', async () => {
  const state = snapshot(); delete state.config; const c = client(state);
  await act(() => root.render(<App initialClient={c.bridge}/>)); await inputText('do not send');
  await act(() => container.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(c.request.mock.calls.some(([r]) => r.type === 'run.start')).toBe(false);
});
it('traps modal focus, ignores new-session shortcut while configuring, and closes with Escape', async () => {
  const c = client(); await act(() => root.render(<App initialClient={c.bridge}/>)); await click('授权工作目录');
  const dialog = container.querySelector('[role=dialog]')!;
  expect(dialog.contains(document.activeElement)).toBe(true);
  await act(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })));
  expect(document.activeElement?.textContent).toBe('确认授权此目录');
  await act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true })));
  expect(c.request.mock.calls.some(([r]) => r.type === 'session.create')).toBe(false);
  await act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(container.querySelector('[role=dialog]')).toBeNull();
});
it('does not resurrect a disconnected UI with an older in-flight snapshot', async () => {
  const c = client(); let resolve!: (value: Result) => void;
  c.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await act(() => root.render(<App initialClient={c.bridge}/>));
  await act(() => c.emit({ type: 'disconnected', message: 'Host stopped' }));
  await act(() => resolve({ snapshot: snapshot() }));
  expect(button('本机 Host 未连接')).toBeTruthy();
  expect(button('新对话').disabled).toBe(true);
});
it('sends an approval once while its response is pending', async () => {
  const state = snapshot(); state.events = [{ version: 1, id: 'approve', at: '', sessionId: 'one', runId: 'run', type: 'approval_requested', data: { id: 'call', name: 'files_write', args: { path: 'note.txt', content: 'text' } } }];
  const c = client(state); await act(() => root.render(<App initialClient={c.bridge}/>));
  let resolve!: (result: Result) => void; c.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await act(() => { button('批准执行').click(); button('批准执行').click(); });
  expect(c.request.mock.calls.filter(([r]) => r.type === 'run.approve')).toHaveLength(1);
  expect(button('拒绝').disabled).toBe(true); await act(() => resolve({}));
});

it('keeps scroll position while reading older messages and offers a return-to-latest action', async () => {
  const c = client(); await act(() => root.render(<App initialClient={c.bridge}/>));
  const scroll = container.querySelector<HTMLElement>('.messages')!;
  Object.defineProperties(scroll, { scrollHeight: { value: 2000 }, clientHeight: { value: 500 }, scrollTop: { value: 0, writable: true } });
  await act(() => scroll.dispatchEvent(new Event('scroll', { bubbles: true })));
  vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
  await act(() => c.emit({ type: 'event', event: { version: 1, id: 'stream', sessionId: 'one', runId: 'run', type: 'assistant_delta', at: '', data: { step: 0, text: 'new output' } } }));
  expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  await click('回到最新消息'); expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledOnce();
});

it('keeps the workspace toggle named and reports expanded state when its visible text is collapsed', async () => {
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1000, left: 0 } as DOMRect);
  try {
    const c = client(); await act(() => root.render(<App initialClient={c.bridge}/>));
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="切换工作区"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.querySelector('svg[data-icon=workspace]')?.getAttribute('aria-hidden')).toBe('true');
    const label = toggle.querySelector('span:not([aria-hidden])') as HTMLElement;
    label.hidden = true; // Mirrors the narrow-column CSS; the explicit name survives.
    toggle.focus(); await act(() => toggle.click());
    expect(toggle.getAttribute('aria-label')).toBe('切换工作区');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.title).toBe('收起工作区'); expect(document.activeElement).toBe(toggle);
    await act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('false'); expect(toggle.title).toBe('展开工作区');
  } finally { bounds.mockRestore(); }
});
it('keeps archive selection in the current project even when another client selected a different scope',async()=>{
 const state=snapshot();state.projects=[{id:'p',name:'P',workspace:'/fixture/p',collapsed:false,createdAt:''}];state.sessions[0].projectId='p';
 state.sessions.push({...state.sessions[0],id:'same',title:'同项目下一条'});
 const c=client(state);await act(()=>root.render(<App initialClient={c.bridge}/>));
 state.sessions[0].archivedAt='2026-10-31';state.selectedId='two';
 await act(()=>c.emit({type:'changed'}));expect(container.querySelector('[aria-current=page]')?.textContent).toBe('同项目下一条');
 state.sessions.find(s=>s.id==='same')!.archivedAt='2026-10-31';
 await act(()=>c.emit({type:'changed'}));expect(container.querySelector('[aria-current=page]')).toBeNull();
 expect(container.querySelector('.composer-footnote')?.textContent).not.toContain('继承项目');
});
it('serializes settings saves and returns focus to the trigger after completion',async()=>{
 const c=client();await act(()=>root.render(<App initialClient={c.bridge}/>));const trigger=button('设置');
 await act(()=>trigger.click());const form=container.querySelector('form:has(select)')!;
 let release!:(r:Result)=>void;c.request.mockImplementationOnce(()=>new Promise(r=>{release=r;}));
 await act(()=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 expect(c.request.mock.calls.filter(([r])=>r.type==='model.save')).toHaveLength(1);
 expect(form.querySelector('fieldset')?.disabled).toBe(true);
 await act(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(container.querySelector('.settings-page')).not.toBeNull();
 await act(()=>release({}));expect(container.querySelector('.settings-content [role=status]')?.textContent).toBe('设置已保存');
 await click('返回工作台');expect(container.querySelector('.settings-page')).toBeNull();expect(document.activeElement).toBe(trigger);
});
it('sends only once for repeated synchronous submit and preserves a draft on failure',async()=>{
 const c=client();await act(()=>root.render(<App initialClient={c.bridge}/>));await inputText('do once');
 let reject!:(e:Error)=>void;c.request.mockImplementationOnce(()=>new Promise((_,r)=>{reject=r;}));
 const form=container.querySelector('.composer')!;
 await act(()=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 expect(c.request.mock.calls.filter(([r])=>r.type==='run.start')).toHaveLength(1);
 await act(()=>reject(new Error('offline test error')));expect(container.querySelector<HTMLTextAreaElement>('[aria-label=消息]')?.value).toBe('do once');expect(container.querySelector('[role=alert]')?.textContent).toContain('offline test error');
});
it('grows multiline composer content without stealing focus and caps its height',async()=>{
 const c=client();await act(()=>root.render(<App initialClient={c.bridge}/>));const input=container.querySelector<HTMLTextAreaElement>('[aria-label=消息]')!;
 Object.defineProperty(input,'scrollHeight',{value:500,configurable:true});const trigger=button('会话 two');trigger.focus();await inputText('many\nlines');
 expect(input.style.height).toBe('220px');expect(document.activeElement).toBe(trigger);
 Object.defineProperty(input,'scrollHeight',{value:20,configurable:true});await inputText('short');expect(input.style.height).toBe('58px');
});
it('has one settings entry and one contextual guide only when a model needs configuration',async()=>{
 const state=snapshot();delete state.config;const c=client(state);await act(()=>root.render(<App initialClient={c.bridge}/>));
 expect(container.querySelectorAll('.sidebar-bottom svg[data-icon=settings]')).toHaveLength(1);
 expect(container.querySelector('.top-actions svg[data-icon=settings]')).toBeNull();
 expect(container.querySelector('.welcome')?.textContent).not.toContain('模型');
 expect(container.querySelectorAll('.model-guidance button')).toHaveLength(1);
 expect(container.querySelector<HTMLSelectElement>('[aria-label=选择模型]')?.disabled).toBe(true);
 const trigger=button('前往设置');await act(()=>trigger.click());expect(container.querySelector('.settings-page')?.getAttribute('aria-label')).toBe('设置页面');
 await act(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));expect(document.activeElement).toBe(trigger);
});
it('switches only the saved model ID without transferring credentials or changing session scope',async()=>{
 const state=snapshot();state.keyPresent=true;state.config={provider:'deepseek',model:'current',baseUrl:'https://api.deepseek.com',thinking:'disabled'};
 const c=client(state);let resolve!:(r:Result)=>void;
 c.request.mockImplementation(async input=>{
  if(input.type==='snapshot')return{snapshot:state};
  if(input.type==='model.list')return{models:[{id:'next'}]};
  if(input.type==='model.save')return new Promise(done=>{resolve=done;});return{};
 });
 await act(()=>root.render(<App initialClient={c.bridge}/>));const select=container.querySelector<HTMLSelectElement>('[aria-label=选择模型]')!;
 expect(container.querySelector('.model-guidance')).toBeNull();
 await act(()=>select.focus());expect(select.querySelector('option[value=next]')).not.toBeNull();
 await act(()=>{select.value='next';select.dispatchEvent(new Event('change',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));});
 const saves=c.request.mock.calls.filter(([r])=>r.type==='model.save');expect(saves).toHaveLength(1);
 expect(saves[0][0]).toEqual({type:'model.save',config:{...state.config,model:'next'}});expect(select.disabled).toBe(true);
 await act(()=>resolve({}));expect(select.disabled).toBe(false);expect(container.querySelector('[role=dialog]')).toBeNull();
 expect(c.request.mock.calls.some(([r])=>r.type==='session.select'||r.type==='workspace.grant')).toBe(false);
});
it('disables model switching while any session runs, and exposes discovery failures without opening settings',async()=>{
 const state=snapshot();state.sessions[1].activeRunId='running';const c=client(state);await act(()=>root.render(<App initialClient={c.bridge}/>));
 const select=container.querySelector<HTMLSelectElement>('[aria-label=选择模型]')!;expect(select.disabled).toBe(true);
 delete state.sessions[1].activeRunId;await act(()=>c.emit({type:'changed'}));
 c.request.mockImplementationOnce(async()=>{throw new Error('model query failed');});await act(()=>select.focus());
 expect(container.querySelector('[role=alert]')?.textContent).toContain('model query failed');expect(container.querySelector('[role=dialog]')).toBeNull();
});
it('keeps the workbench mounted and restores draft, selected session and preview after leaving settings',async()=>{
 const c=client();await act(()=>root.render(<App initialClient={c.bridge}/>));await inputText('保留草稿');
 const toggle=container.querySelector<HTMLButtonElement>('[aria-label=切换工作区]')!;await act(()=>toggle.click());
 const workbench=container.querySelector<HTMLElement>('.workbench')!,textarea=container.querySelector('textarea');const preview=container.querySelector('.browser-inspector');
 await click('设置');expect(workbench.style.display).toBe('none');expect(workbench.hasAttribute('inert')).toBe(true);
 await act(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'n',ctrlKey:true,bubbles:true})));expect(c.request.mock.calls.some(([r])=>r.type==='session.create')).toBe(false);
 await click('返回工作台');expect(workbench.style.display).toBe('');expect(container.querySelector('textarea')).toBe(textarea);expect(textarea?.value).toBe('保留草稿');expect(container.querySelector('.browser-inspector')).toBe(preview);expect(toggle.getAttribute('aria-expanded')).toBe('true');
});
it('explains the connection prerequisite before asking a disconnected user to create a session',async()=>{
 await act(()=>root.render(<App/>));await click('授权工作目录');expect(container.querySelector('[role=alert]')?.textContent).toContain('本机服务未连接');expect(container.querySelector('[role=alert]')?.textContent).not.toContain('先新建');
});
it('requires explicit discard for unsaved settings and clears input credentials on leaving',async()=>{
 const state=snapshot();state.config={provider:'deepseek',model:'original',baseUrl:'https://api.deepseek.com'};const c=client(state);
 await act(()=>root.render(<App initialClient={c.bridge}/>));await click('设置');const key=container.querySelector<HTMLInputElement>('.settings-page input[type=password]')!;
 await act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(key,'fake-test-only');key.dispatchEvent(new Event('input',{bubbles:true}));});
 await click('返回工作台');expect(container.querySelector('[role=alertdialog]')).not.toBeNull();expect(document.activeElement?.textContent).toBe('继续编辑');
 await act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true})));expect(document.activeElement?.textContent).toBe('放弃更改并返回');
 await act(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));expect(container.querySelector('[role=alertdialog]')).toBeNull();expect(key.value).toBe('fake-test-only');
 await click('取消并返回');await click('放弃更改并返回');expect(c.request.mock.calls.some(([r])=>r.type==='model.save')).toBe(false);
 await click('设置');expect(container.querySelector<HTMLInputElement>('.settings-page input[type=password]')?.value).toBe('');
});
it('saves custom endpoint settings without persisting a key and preserves unsaved configuration across categories',async()=>{
 const state=snapshot();state.config={provider:'deepseek',model:'original',baseUrl:'https://api.deepseek.com'};state.credential={storage:'secure',saved:true};state.keyPresent=true;
 const c=client(state);await act(()=>root.render(<App initialClient={c.bridge}/>));await click('设置');
 const endpoint=container.querySelector<HTMLInputElement>('.settings-page input[type=url]')!;
 await act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(endpoint,'https://example.com/v1');endpoint.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(()=>container.querySelector<HTMLButtonElement>('.settings-navigation nav button:last-child')!.click());
 await act(()=>container.querySelector<HTMLButtonElement>('.settings-navigation nav button:first-child')!.click());expect(endpoint.value).toBe('https://example.com/v1');
 const checkbox=container.querySelector<HTMLInputElement>('.settings-page input[type=checkbox]')!;expect(checkbox.checked).toBe(false);expect(checkbox.disabled).toBe(true);
 await click('保存设置');expect(c.request.mock.calls.find(([r])=>r.type==='model.save')?.[0]).toEqual({type:'model.save',config:{...state.config,baseUrl:'https://example.com/v1'},rememberKey:false});
 expect(container.querySelector('.settings-page')).not.toBeNull();
});
it('routes connection status to the same dedicated settings page without another configuration modal',async()=>{
 await act(()=>root.render(<App/>));await click('本机 Host 未连接');
 expect(container.querySelector('.settings-page h2')?.textContent).toBe('本机连接');expect(container.querySelector('[role=dialog]')).toBeNull();
 expect(container.querySelector('.settings-navigation [aria-current=page]')?.textContent).toBe('本机连接');
 await click('返回工作台');expect(container.querySelector('.settings-page')).toBeNull();
});
it('groups settings actions while keeping cancel available when the Host is disconnected',async()=>{
 await act(()=>root.render(<App/>));await click('设置');
 const actions=container.querySelector('.settings-actions')!;
 expect(Array.from(actions.querySelectorAll('button')).map(b=>b.textContent)).toEqual(['取消并返回','保存并查询模型','保存设置']);
 const buttons=actions.querySelectorAll('button');expect(buttons[0].disabled).toBe(false);expect(buttons[1].disabled).toBe(true);expect(buttons[2].disabled).toBe(true);
 await act(()=>buttons[0].click());expect(container.querySelector('.settings-page')).toBeNull();
});
it('announces settings results beside actions and restores submit focus only if the user did not move it',async()=>{
 const c=client();await act(()=>root.render(<App initialClient={c.bridge}/>));await click('设置');
 const save=button('保存设置'),form=save.form!;
 for(const move of [false,true]){
  let release!:(r:Result)=>void;c.request.mockImplementationOnce(()=>new Promise(done=>{release=done;}));
  save.focus();await act(()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  // jsdom keeps a disabled button focused; model the browser's focus drop explicitly.
  const activeElement=move?undefined:vi.spyOn(document,'activeElement','get').mockReturnValue(document.body);
  const restored=vi.spyOn(save,'focus');restored.mockClear();
  const nav=container.querySelector<HTMLButtonElement>('.settings-navigation nav button:last-child')!;
  if(move)await act(()=>nav.focus());
  await act(()=>release({}));expect(restored).toHaveBeenCalledTimes(move?0:1);activeElement?.mockRestore();restored.mockRestore();expect(document.activeElement).toBe(move?nav:save);
  const feedback=form.querySelector('.settings-feedback')!;expect(feedback.getAttribute('aria-live')).toBe('polite');expect(feedback.textContent).toContain('设置已保存');expect(feedback.nextElementSibling?.className).toBe('settings-actions');
 }
});
it('replaces saved feedback on new edits, preserves errors and does not erase a newer credential on async completion',async()=>{
 const state=snapshot();state.config={provider:'deepseek',model:'test-model',baseUrl:'https://api.deepseek.com'};
 const c=client(state);await act(()=>root.render(<App initialClient={c.bridge}/>));await click('设置');
 const key=container.querySelector<HTMLInputElement>('.settings-page input[type=password]')!;
 const editKey=async(value:string)=>act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(key,value);key.dispatchEvent(new Event('input',{bubbles:true}));});
 const feedback=container.querySelector('.settings-feedback')!;
 await click('保存设置');expect(feedback.textContent).toBe('设置已保存');
 await editKey('fake-new-key');expect(feedback.textContent).toBe('有未保存的更改');
 let finish!:(result:Result)=>void;c.request.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 await click('保存设置');
 // Model a delayed completion after an external input update; ordinary user inputs are disabled while saving.
 await editKey('fake-newer-key');await act(()=>finish({}));
 expect(key.value).toBe('fake-newer-key');expect(feedback.textContent).toBe('有未保存的更改');
 c.request.mockImplementationOnce(async()=>{throw new Error('test save failed');});await click('保存设置');
 await editKey('fake-after-error');expect(feedback.textContent).toBe('test save failed');expect(feedback.querySelector('[role=alert]')).not.toBeNull();
});
