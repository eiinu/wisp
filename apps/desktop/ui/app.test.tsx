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
  const c = client(); await act(() => root.render(<App initialClient={c.bridge}/>)); await click('模型与设置');
  const dialog = container.querySelector('[role=dialog]')!;
  expect(dialog.contains(document.activeElement)).toBe(true);
  await act(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })));
  expect(document.activeElement?.textContent).toBe('保存设置');
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
