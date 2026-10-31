// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Markdown } from './markdown.js';
import { LinkConfirmationProvider } from './link-confirmation.js';
let container:HTMLDivElement, root:Root;
beforeEach(()=>{ (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true; container=document.createElement('div');document.body.append(container);root=createRoot(container); });
afterEach(async()=>{await act(()=>root.unmount());container.remove();});
it('does not expose a navigable external anchor, confirms once, and cancels stale streamed links',async()=>{
  const open=vi.fn(); const render=async(text:string)=>act(()=>root.render(<LinkConfirmationProvider onOpen={open}><Markdown text={text}/></LinkConfirmationProvider>));
  await render('[Example](https://example.com/a)'); expect(container.querySelector('a')).toBeNull();
  const link=container.querySelector<HTMLButtonElement>('.markdown-link')!; link.focus(); await act(()=>link.click());
  expect(open).not.toHaveBeenCalled();expect(container.querySelector('[role=alertdialog]')?.textContent).toContain('https://example.com/a');expect(document.activeElement?.textContent).toBe('取消');
  await act(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(container.querySelector('[role=alertdialog]')).toBeNull();expect(document.activeElement).toBe(link);
  await act(()=>link.click()); await render('[Example](https://example.com/b)');expect(container.querySelector('[role=alertdialog]')).toBeNull();
  await act(()=>container.querySelector<HTMLButtonElement>('.markdown-link')!.click());const confirm=Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='确认打开')!;
  await act(()=>{confirm.click();confirm.click();});expect(open).toHaveBeenCalledExactlyOnceWith({kind:'web',url:'https://example.com/b'});
});
it('resolves relative file links with session provenance and denies unsafe links',async()=>{
  const open=vi.fn();await act(()=>root.render(<LinkConfirmationProvider onOpen={open}><Markdown text={'[file](../notes.txt) [bad](javascript:alert)'} source={{kind:'file',sessionId:'s',workspace:'/allowed',path:'docs/readme.md'}}/></LinkConfirmationProvider>));
  expect(container.querySelectorAll('.markdown-link')).toHaveLength(1);await act(()=>container.querySelector<HTMLButtonElement>('.markdown-link')!.click());await act(()=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='确认打开')!.click());expect(open).toHaveBeenCalledWith({kind:'file',sessionId:'s',workspace:'/allowed',path:'notes.txt'});
});
