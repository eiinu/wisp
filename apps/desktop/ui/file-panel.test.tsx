// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Request, Result } from '@wisp/core';
import { FilePanel, FileContents } from './file-panel.js';

let container: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(() => root.unmount()); container.remove(); });
const entries = [{ name: 'note.txt', path: 'note.txt', kind: 'file' as const, size: 20 }, { name: 'note.md', path: 'note.md', kind: 'file' as const, size: 20 }];
const props = { sessionId: 'one', workspace: '/authorized', connected: true, active: false, chooseWorkspace: vi.fn() };
const button = (text: string) => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes(text))!;
const click = async (text: string) => { await act(() => button(text).click()); };

it('auto-loads the authorized directory, previews txt literally and md through Markdown, and shows empty files', async () => {
  const request = vi.fn(async (input: Request): Promise<Result> => input.type === 'files.list' ? { entries } : { file: { path: 'note.txt', kind: 'text', text: '# literal <b>not HTML</b>\nline 2', size: 20 } });
  await act(() => root.render(<FilePanel {...props} request={request}/>));
  await click('note.txt'); expect(container.querySelector('.plain-text')?.textContent).toContain('<b>not HTML</b>'); expect(container.querySelector('b')).toBeNull();
  request.mockResolvedValueOnce({ file: { path: 'note.md', kind: 'markdown', text: '# heading\n\n- item', size: 20 } });
  await click('note.md'); expect(container.querySelector('h1')?.textContent).toBe('heading'); expect(container.querySelector('li')?.textContent).toBe('item');
  request.mockResolvedValueOnce({ file: { path: 'note.txt', kind: 'text', text: '', size: 0 } });
  await click('note.txt'); expect(container.textContent).toContain('空文件');
});
it('clears old content while loading and does not show stale reads or failures after a newer selection', async () => {
  let old!: (result: Result) => void;
  const request = vi.fn(async (input: Request): Promise<Result> => input.type === 'files.list' ? { entries } : {});
  await act(() => root.render(<FilePanel {...props} request={request}/>));
  request.mockImplementationOnce(() => new Promise(resolve => { old = resolve; }));
  await click('note.txt'); expect(container.textContent).toContain('正在读取文件');
  request.mockRejectedValueOnce(new Error('文件超过 2 MB 预览限制'));
  await click('note.md'); expect(container.querySelector('[role=alert]')?.textContent).toContain('2 MB');
  await act(() => old({ file: { path: 'note.txt', kind: 'text', text: 'STALE', size: 5 } }));
  expect(container.textContent).not.toContain('STALE');
});
it('discards an in-flight file when switching sessions or authorized directories', async () => {
  let old!: (result: Result) => void;
  const request = vi.fn(async (): Promise<Result> => ({ entries }));
  await act(() => root.render(<FilePanel key="one" {...props} request={request}/>));
  request.mockImplementationOnce(() => new Promise(resolve => { old = resolve; })); await click('note.txt');
  await act(() => root.render(<FilePanel key="two" {...props} sessionId="two" workspace="/other" request={request}/>));
  await act(() => old({ file: { path: 'note.txt', kind: 'text', text: 'other session secret', size: 20 } }));
  expect(container.textContent).not.toContain('other session secret');
  expect(request).toHaveBeenLastCalledWith({ type: 'files.list', sessionId: 'two', path: '' });
});
it('makes truncation explicit and never enables editing truncated previews', async () => {
  const file = { path: 'large.md', kind: 'markdown' as const, text: 'x'.repeat(100001), size: 100001 };
  await act(() => root.render(<FileContents file={file}/>));
  expect(container.textContent).toContain('已截断'); expect(container.querySelector('.markdown')?.textContent?.length).toBe(100000);
});
it('submits new files for approval without claiming the write completed', async () => {
  const request = vi.fn(async (): Promise<Result> => ({ entries }));
  await act(() => root.render(<FilePanel {...props} request={request}/>));
  await click('新建'); expect(container.textContent).toContain('尚未保存');
  await click('提交写入审批');
  expect(request).toHaveBeenLastCalledWith({ type: 'files.write', sessionId: 'one', path: 'notes.md', content: '' });
  expect(container.textContent).toContain('写入已提交审批');
});
