import React, { useEffect, useRef, useState, type Dispatch } from 'react';
import type { Request, Result } from '@wisp/core';
import type { BrowserBridge, BrowserSnapshot } from '../shared/browser.js';
import { FilePanel } from './file-panel.js';
import { useLinkConfirmation } from './link-confirmation.js';
import { safeWebUrl, type PreviewAction, type PreviewState, type PreviewTarget } from './preview-model.js';

export function BrowserPanel({ state, dispatch, visible, blocked, close, sessionId, workspace, connected, active, request, chooseWorkspace, browser = window.wisp?.browser }: {
  state: PreviewState; dispatch: Dispatch<PreviewAction>; visible: boolean; blocked: boolean; close(): void;
  sessionId?: string; workspace?: string; connected: boolean; active: boolean; request(request: Request): Promise<Result>; chooseWorkspace(): void; browser?: BrowserBridge;
}) {
  const confirmation = useLinkConfirmation();
  const [native, setNative] = useState<BrowserSnapshot>({ pages: [], downloads: [] });
  const [address, setAddress] = useState(''), [error, setError] = useState(''), [downloads, showDownloads] = useState(false);
  const [fallback, setFallback] = useState<Record<string, { url: string; revision: number; loaded: boolean }>>({});
  const viewport = useRef<HTMLDivElement>(null), opened = useRef(new Map<string, number>());
  const tab = state.tabs.find(t => t.id === state.activeId), page = native.pages.find(p => p.id === tab?.id);
  const displayedUrl = page?.url ?? (tab?.kind === 'web' ? fallback[tab.id]?.url ?? tab.url : '');
  const command = async (input: Parameters<BrowserBridge['command']>[0]) => { try { if (browser) setNative(await browser.command(input)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  useEffect(() => { if (!browser) return; const unsubscribe = browser.subscribe(setNative); void command({ type: 'snapshot' }); return unsubscribe; }, [browser]);
  useEffect(() => {
    if (!browser) return;
    for (const old of opened.current.keys()) if (!state.tabs.some(t => t.id === old)) { opened.current.delete(old); void command({ type: 'close', id: old }); }
    for (const item of state.tabs) if (item.kind === 'web' && item.url && opened.current.get(item.id) !== (item.revision ?? 0)) { opened.current.set(item.id, item.revision ?? 0); void command({ type: 'open', id: item.id, url: item.url }); }
  }, [state.tabs, browser]);
  useEffect(() => () => { if (browser) { for (const id of opened.current.keys()) void browser.command({ type: 'close', id }).catch(() => {}); opened.current.clear(); } }, [browser]);
  useEffect(() => { setAddress(displayedUrl); setError(''); }, [tab?.id, displayedUrl]);
  useEffect(() => window.wisp?.onBrowserOpen?.(url => confirmation?.request({ kind: 'web', url }, 'browser-popup')), [confirmation?.request]);
  useEffect(() => {
    if (!browser) return;
    const layout = () => {
      const bounds = viewport.current?.getBoundingClientRect();
      void command(visible && !blocked && !confirmation?.blocked && !downloads && tab?.kind === 'web' && bounds && bounds.width > 0 && bounds.height > 0 ? { type: 'layout', id: tab.id, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } } : { type: 'layout' });
    };
    layout(); const observer = new ResizeObserver(layout); if (viewport.current) observer.observe(viewport.current); window.addEventListener('resize', layout);
    return () => { observer.disconnect(); window.removeEventListener('resize', layout); void browser.command({ type: 'layout' }).catch(() => {}); };
  }, [browser, visible, blocked, confirmation?.blocked, downloads, tab?.id, tab?.kind, page?.url]);
  function navigate() {
    if (tab?.kind !== 'web') return;
    const url = safeWebUrl(address.includes('://') ? address : `https://${address}`);
    if (!url) { setError('请输入不含凭据的 HTTP 或 HTTPS 地址'); return; }
    setError('');
    if (browser) { opened.current.set(tab.id, tab.revision ?? 0); void command({ type: 'open', id: tab.id, url }); }
    else setFallback(previous => ({ ...previous, [tab.id]: { url, revision: (previous[tab.id]?.revision ?? 0) + 1, loaded: false } }));
  }
  const open = (target: PreviewTarget | {kind: 'workspace'}) => dispatch({ type: 'open', target });
  const fileProps = { sessionId, workspace, connected, active, request, chooseWorkspace };
  return <aside className="inspector browser-inspector" hidden={!visible} aria-label="浏览工作区">
    <div className="inspector-heading"><strong>浏览工作区</strong><div><button onClick={() => { showDownloads(!downloads); }} aria-pressed={downloads}>下载{native.downloads.length ? ` (${native.downloads.length})` : ''}</button><button className="icon" onClick={close} aria-label="关闭预览">×</button></div></div>
    <div className="browser-tabs" role="tablist" aria-label="预览标签">{state.tabs.map((item, index) => <div className="browser-tab" key={item.id}><button role="tab" aria-selected={item.id === tab?.id} tabIndex={item.id === tab?.id ? 0 : -1} onClick={() => dispatch({ type: 'select', id: item.id })} onKeyDown={e => {
      let next: number | undefined; if (e.key === 'ArrowRight') next = (index + 1) % state.tabs.length; if (e.key === 'ArrowLeft') next = (index + state.tabs.length - 1) % state.tabs.length; if (e.key === 'Home') next = 0; if (e.key === 'End') next = state.tabs.length - 1;
      if (next !== undefined) { e.preventDefault(); dispatch({ type: 'select', id: state.tabs[next].id }); (e.currentTarget.closest('[role=tablist]')?.querySelectorAll('[role=tab]')[next] as HTMLElement)?.focus(); }
      if (e.key === 'Delete') dispatch({ type: 'close', id: item.id });
    }} title={native.pages.find(p => p.id === item.id)?.title ?? item.title}>{item.kind === 'web' ? '◎ ' : '▤ '}{native.pages.find(p => p.id === item.id)?.title ?? item.title}</button><button aria-label={`关闭 ${item.title}`} onClick={() => dispatch({ type: 'close', id: item.id })}>×</button></div>)}<button aria-label="新标签页" onClick={() => { showDownloads(false); dispatch({ type: 'open', id: `web:${crypto.randomUUID()}`, target: { kind: 'web', url: '' } }); }}>＋</button></div>
    {downloads ? <div className="download-list"><h3>下载管理器</h3>{!browser ? <p>Web 预览无法管理浏览器下载，请使用桌面版。</p> : !native.downloads.length ? <p>尚无下载。下载时会显示系统保存对话框。</p> : native.downloads.map(d => <article key={d.id}><strong>{d.name}</strong><p className="confirm-target">{d.url}</p><progress value={d.total > 0 ? d.received : undefined} max={d.total || undefined}/><p>{d.received.toLocaleString()} / {d.total > 0 ? d.total.toLocaleString() : '未知'} B · {d.state}</p>{d.state === 'progressing' && <button onClick={() => void command({ type: 'cancel-download', id: d.id })}>取消下载</button>}</article>)}</div> : <>
      {tab?.kind === 'web' && <><form className="browser-address" onSubmit={e => { e.preventDefault(); navigate(); }}><button type="button" aria-label="后退" disabled={!page?.back} onClick={() => void command({ type: 'back', id: tab.id })}>←</button><button type="button" aria-label="前进" disabled={!page?.forward} onClick={() => void command({ type: 'forward', id: tab.id })}>→</button><button type="button" aria-label="刷新网页" disabled={!displayedUrl} onClick={() => browser ? void command({ type: 'reload', id: tab.id }) : setFallback(p => ({ ...p, [tab.id]: { url: displayedUrl, revision: (p[tab.id]?.revision ?? 0) + 1, loaded: false } }))}>↻</button><input aria-label="地址栏" placeholder="输入网址" value={address} onChange={e => setAddress(e.target.value)}/><button>打开</button></form>
        {!browser && <p className="web-note">Web 嵌入预览：不支持历史导航或下载管理。网站可能禁止嵌入；无法确认页面内容或重定向后的地址。</p>}
        {(error || page?.error) && <p role="alert" className="error">{error || page?.error}</p>}{page?.loading && <p role="status" className="web-note">正在加载网页…</p>}
        <div className="browser-viewport" ref={viewport}>{!displayedUrl ? <div className="panel-empty"><span>◎</span><h3>新标签页</h3><p>在地址栏输入网址并打开。</p></div> : !browser ? <iframe key={`${tab.id}:${fallback[tab.id]?.revision ?? 0}`} title="用户选择的网页" src={displayedUrl} sandbox="allow-scripts" referrerPolicy="no-referrer"/> : null}</div></>}
      {tab?.kind === 'workspace' && <div className="browser-file"><FilePanel key={`${sessionId}:${workspace}`} {...fileProps} onOpenFile={path => { if (sessionId && workspace) open({ kind: 'file', sessionId, workspace, path }); }}/></div>}
      {tab?.kind === 'file' && tab.sessionId === sessionId && tab.workspace === workspace && <div className="browser-file"><FilePanel key={tab.id} {...fileProps} filePath={tab.path}/></div>}
      {!tab && <div className="panel-empty"><h3>打开一个标签</h3><button onClick={() => open({kind: 'workspace'})}>工作目录</button></div>}
    </>}
  </aside>;
}
