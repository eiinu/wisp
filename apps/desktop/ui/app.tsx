import React, { useCallback, useReducer, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { WorkbenchBridge, Request, Snapshot, RunEvent, Result } from '@wisp/core';
import { webBridge } from './bridge.js';
import { copyText } from './clipboard.js';
import { previewDelivery } from './preview-delivery.js';
import { groupExecution } from './tool-groups.js';
import { ToolActivity } from './tool-activity.js';
import { Markdown } from './markdown.js';
import { ProjectSidebar } from './project-sidebar.js';
import { SplitWorkspace } from './split-workspace.js';
import { BrowserPanel } from './browser-panel.js';
import { previewReducer, type PreviewTarget } from './preview-model.js';
import { LinkConfirmationProvider } from './link-confirmation.js';
import type { BrowserBridge } from '../shared/browser.js';
import { SettingsPage } from './settings-page.js';
import { ModelSelector } from './model-selector.js';
import { WorkspaceIcon } from './workspace-icon.js';
import './style.css';
declare global { interface Window { wisp?: WorkbenchBridge & { browser?: BrowserBridge; onBrowserOpen?(callback: (url: string) => void): () => void; copyText(text: string): Promise<void>; chooseDirectory(): Promise<string | undefined>; openUrl(url: string): Promise<void> } } }
const empty: Snapshot = { sessions: [], events: [], keyPresent: false, browserConnected: false };
const labels: Record<string, string> = { model_activity: '思考中', model_usage: '模型用量', model_finish: '模型结束', model_error: '模型错误', started: '任务开始', assistant: '回复', assistant_delta: '生成中', tool_requested: '调用工具', tool_result: '工具结果', approval_requested: '等待批准', approval_resolved: '审批结果', completed: '已完成', cancelled: '已取消', failed: '执行失败' };
function initialBridge() {
  if (window.wisp) return window.wisp;
  const token = new URLSearchParams(location.hash.slice(1)).get('connect');
  if (token) { history.replaceState(null, '', location.pathname + location.search); return webBridge(token); }
  return undefined;
}
export function App({ initialClient }: { initialClient?: WorkbenchBridge } = {}) {
  const [bridge, setBridge] = useState<WorkbenchBridge | undefined>(() => initialClient ?? initialBridge()), [connected, setConnected] = useState(false), [snapshot, setSnapshot] = useState<Snapshot>(empty);
  const [connectionAttempt, setConnectionAttempt] = useState(0), [awayFromBottom, setAwayFromBottom] = useState(false);
  const [selected, setSelected] = useState<string>(), [drafts, setDrafts] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [panel, setPanel] = useState<boolean>(false), [modal, setModal] = useState<'workspace' | undefined>(), [sidebar, setSidebar] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false), [settingsSection, setSettingsSection] = useState<'model' | 'connection'>('model');
  const settingsReturn = useRef<HTMLElement | null>(null), settingsTrigger = useRef<HTMLButtonElement>(null);
  const [projectDialog, setProjectDialog] = useState(false);
  const sessionCreating = useRef(false), sendLock = useRef(false), modalLock = useRef(false);
  const [modalPending, setModalPending] = useState(false);
  const composerInput = useRef<HTMLTextAreaElement>(null), modalReturn = useRef<HTMLElement | null>(null);
  const openModal = (value: 'settings' | 'workspace' | 'connect', trigger?: HTMLElement) => { if (value === 'settings' || value === 'connect') { setSettingsSection(value === 'connect' ? 'connection' : 'model'); settingsReturn.current = trigger ?? document.activeElement as HTMLElement; setSettingsOpen(true); return; } modalReturn.current = trigger ?? document.activeElement as HTMLElement; setModal(value); };
  const [workspace, setWorkspace] = useState('');
  const [preview, dispatchPreview] = useReducer(previewReducer, { tabs: [] });
  const openPreview = useCallback((target: PreviewTarget) => { dispatchPreview({type: 'open', target}); setPanel(true); }, []);
  const [copied, setCopied] = useState('');
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const approvalLocks = useRef(new Set<string>()), [approving, setApproving] = useState<string[]>([]);
  const bottom = useRef<HTMLDivElement>(null), messageScroll = useRef<HTMLDivElement>(null), followStream = useRef(true), modalElement = useRef<HTMLElement>(null);
  const current = snapshot.sessions.find(s => s.id === selected && !s.archivedAt), events = snapshot.events.filter(e => e.sessionId === selected);
  const prompt = drafts[selected ?? 'new'] ?? '', active = current?.activeRunId;
  const modelReady = !!snapshot.config && (snapshot.config.provider === 'offline' || snapshot.keyPresent);
  const api = async (request: Request): Promise<Result> => { if (!bridge || !connected) throw new Error('本机 Host 未连接'); return bridge.request(request); };
  const action = async (task: () => Promise<unknown>) => { setError(''); try { return await task(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  const modalAction = async (task: () => Promise<unknown>) => {
    if (modalLock.current) return;
    modalLock.current = true; setModalPending(true);
    try { await action(task); } finally { modalLock.current = false; setModalPending(false); }
  };
  const closeModal = () => { if (!modalLock.current) { setModal(undefined); } };
  useLayoutEffect(() => {
    const input = composerInput.current; if (!input) return;
    const resize = () => { input.style.height = 'auto'; input.style.height = `${Math.min(220, Math.max(58, input.scrollHeight))}px`; };
    resize(); let width = input.getBoundingClientRect().width;
    const observer = new ResizeObserver(entries => { const next = entries[0]?.contentRect.width; if (next !== undefined && next !== width) { width = next; resize(); } });
    observer.observe(input); return () => observer.disconnect();
  }, [prompt, selected]);
  useEffect(() => {
    if (!bridge) return;
    let live = true, generation = 0;
    setConnected(false);
    async function refresh() {
      const revision = ++generation;
      try {
        const { snapshot: next } = await bridge!.request({ type: 'snapshot' });
        if (!live || revision !== generation || !next) return;
        setSnapshot(previous => ({ ...next, events: [...new Map([...next.events, ...previous.events.filter(e => !next.events.some(n => n.id === e.id))].map(e => [e.id, e])).values()] }));
        setSelected(value => {
          const previous = next.sessions.find(s => s.id === value);
          if (previous?.archivedAt) return next.sessions.find(s => !s.archivedAt && s.projectId === previous.projectId)?.id;
          return previous ? value : next.selectedId;
        });
        setConnected(true); setError('');
      } catch (e) { if (live && revision === generation) { setError(String(e)); setConnected(false); } }
    }
    const deliverPreview = previewDelivery(() => live ? selectedRef.current : undefined, input=>bridge!.request(input), url=>openPreview({kind:'web',url}));
    const unsubscribe = bridge.subscribe(notice => {
      if (notice.type === 'preview.open') void deliverPreview(notice);
      if (!live) return;
      if (notice.type === 'disconnected') { generation++; setConnected(false); setError(notice.message); }
      if (notice.type === 'changed') void refresh();
      if (notice.type === 'event') {
        const e = notice.event;
        setSnapshot(s => ({ ...s, events: s.events.some(old => old.id === e.id) ? s.events : [...s.events, e], sessions: s.sessions.map(session => session.id !== e.sessionId ? session : { ...session, updatedAt: e.at, activeRunId: e.type === 'started' ? e.runId : session.activeRunId }) }));
      }
    });
    void refresh();
    return () => { live = false; generation++; unsubscribe(); };
  }, [bridge, connectionAttempt]);
  useEffect(() => { followStream.current = true; setAwayFromBottom(false); bottom.current?.scrollIntoView({ block: 'end' }); }, [selected]);
  useEffect(() => { if (followStream.current) bottom.current?.scrollIntoView({ block: 'end' }); }, [events.length]);
  useEffect(() => {
    if (!modal) return;
    const previous = modalReturn.current ?? document.activeElement as HTMLElement | null;
    const dialog = modalElement.current;
    const elements = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? []);
    elements()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const targets = elements(), first = targets[0], last = targets.at(-1);
      if (!targets.length) { event.preventDefault(); dialog?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement) || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement) || document.activeElement === dialog)) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus(); };
  }, [modal]);
  useEffect(() => { setWorkspace(current?.workspace ?? ''); }, [selected, current?.workspace]);
  useEffect(() => { if (!settingsOpen && settingsReturn.current) { (settingsReturn.current.isConnected ? settingsReturn.current : settingsTrigger.current)?.focus(); settingsReturn.current = null; } }, [settingsOpen]);
  const newSession = () => action(async () => { if (sessionCreating.current) return; sessionCreating.current = true; try { const result = await api({ type: 'session.create', title: '新会话' }); setSelected(result.sessionId); setSidebar(false); composerInput.current?.focus(); } finally { sessionCreating.current = false; } });
  const select = (id: string) => { setSelected(id); setSidebar(false); void action(() => api({ type: 'session.select', sessionId: id })); };
  const send = async () => {
    if (!connected || !modelReady || !prompt.trim() || active || sendLock.current) return;
    sendLock.current = true;
    const originalPrompt = prompt, savedPrompt = prompt.trim(), original = selected ?? 'new'; setBusy(true);
    await action(async () => {
      let id = selected;
      if (!id) id = (await api({ type: 'session.create', title: savedPrompt.slice(0, 30) })).sessionId;
      if (!id) throw new Error('创建会话失败');
      if ((selectedRef.current ?? 'new') === original) setSelected(id);
      await api({ type: 'run.start', sessionId: id, prompt: savedPrompt, maxSteps: 8 });
      if (current?.title === '新会话') await api({ type: 'session.rename', sessionId: id, title: savedPrompt.slice(0, 30) });
      setDrafts(d => d[original] === originalPrompt ? { ...d, [original]: '' } : d);
    }); sendLock.current = false; setBusy(false);
  };
  const approve = async (sessionId: string, runId: string, callId: string, allowed: boolean) => {
    if (approvalLocks.current.has(callId)) return;
    approvalLocks.current.add(callId); setApproving(Array.from(approvalLocks.current));
    try { await action(() => api({ type: 'run.approve', sessionId, runId, callId, allowed })); }
    finally { approvalLocks.current.delete(callId); setApproving(Array.from(approvalLocks.current)); }
  };
  const showWorkspace = () => { if (!preview.tabs.length) dispatchPreview({type: 'open', target: {kind: 'workspace'}}); setPanel(!panel); };
  useEffect(() => { dispatchPreview({type: 'scope', sessionId: selected, workspace: current?.workspace}); }, [selected, current?.workspace]);

  const chooseWorkspace = (event?: React.MouseEvent<HTMLButtonElement>) => { if (!connected) { setError('本机服务未连接，请先连接本机 Host 后再授权工作目录'); return; } if (current?.projectId) { dispatchPreview({type:'open',target:{kind:'workspace'}}); setPanel(true); return; } if (!selected) { setError('请先新建一个会话，再授权目录'); return; } setWorkspace(current?.workspace ?? ''); openModal('workspace', event?.currentTarget); };
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); if (connected && !modal && !projectDialog && !settingsOpen) void newSession(); }
      if (event.key === 'Escape') { closeModal(); setSidebar(false); }
    };
    window.addEventListener('keydown', shortcuts); return () => window.removeEventListener('keydown', shortcuts);
  }, [connected, bridge, modal, projectDialog, settingsOpen]);
  const runs = [...new Set(events.map(e => e.runId))];
  return <LinkConfirmationProvider onOpen={openPreview}><div className={`workbench ${sidebar ? 'sidebar-visible' : ''}`} style={settingsOpen ? { display: 'none' } : undefined} inert={settingsOpen}>
    <aside className="sidebar"><div className="brand"><span className="mark">w</span><strong>Wisp</strong><button className="icon mobile" onClick={() => setSidebar(false)} aria-label="关闭侧栏"><WorkspaceIcon name="close"/></button></div>
      <button className="new-chat" onClick={() => void newSession()} disabled={!connected}><WorkspaceIcon name="plus"/> 新对话 <kbd>⌘ N</kbd></button>
      <ProjectSidebar projects={snapshot.projects ?? []} sessions={snapshot.sessions} selected={selected} connected={connected} request={api} select={select} chooseDirectory={window.wisp?.chooseDirectory} onDialogChange={setProjectDialog} openDirectory={id => { select(id); dispatchPreview({type:'open',target:{kind:'workspace'}}); setPanel(true); }}/>

      <div className="sidebar-bottom"><button ref={settingsTrigger} onClick={event => openModal('settings', event.currentTarget)}><WorkspaceIcon name="settings"/><span>设置<small>{snapshot.config?.model ?? '尚未配置模型'}</small></span></button><button onClick={event => openModal('connect', event.currentTarget)}><span className={`connection-dot ${connected ? 'online' : ''}`}/><span>{connected ? '本机 Host 已连接' : '本机 Host 未连接'}<small>{connected ? '数据保存在你的电脑' : '当前仅查看工作台界面'}</small></span></button></div>
    </aside>
    <SplitWorkspace visible={panel} right={({ dragging }) => <BrowserPanel state={preview} dispatch={dispatchPreview} visible={!!panel} blocked={!!modal || projectDialog || dragging || settingsOpen} close={() => setPanel(false)} sessionId={selected} workspace={current?.workspace} inheritedWorkspace={!!current?.projectId} connected={connected} active={!!active} request={api} chooseWorkspace={chooseWorkspace}/>}>
    <div className="workspace"><header className="topbar"><div><button className="icon mobile" onClick={() => setSidebar(true)} aria-label="打开侧栏"><WorkspaceIcon name="menu"/></button><ModelSelector key={`${snapshot.config?.provider}:${snapshot.config?.baseUrl}:${snapshot.keyPresent}`} config={snapshot.config} disabled={!connected || !modelReady || busy || modalPending || snapshot.sessions.some(session => !!session.activeRunId) || snapshot.config?.model === 'wisp-dev-simulator'} request={api} onError={setError}/></div><div className="top-actions"><button className={panel ? 'active' : ''} onClick={showWorkspace} aria-label="切换工作区" aria-expanded={panel} title={panel ? '收起工作区' : '展开工作区'}><WorkspaceIcon name="workspace"/> <span>工作区</span></button></div></header>
      {connected && snapshot.config?.model === 'wisp-dev-simulator' && <div className="connection-banner"><span>开发模拟 · 脚本模型，非真实 DeepSeek；文件工具真实执行，仅用于临时目录验证。</span></div>}
      {!connected && <div className="connection-banner"><span>{window.wisp ? error ? '本机 Host 连接失败，请重试；若 Host 已停止，请重新启动 Wisp。' : '正在连接本机 Host。如出现 Wisp Safe Storage 系统提示，请按需授权读取已保存的 Key；密码仅输入系统弹窗。' : '此界面未连接本机 Host，不能执行任务或读取文件。'}</span>{window.wisp ? <button onClick={() => { setError(''); setConnectionAttempt(value => value + 1); }}>重新连接</button> : <button onClick={event => openModal('connect', event.currentTarget)}>连接 Host <WorkspaceIcon name="forward"/></button>}</div>}

      <div className="workspace-body"><main className="conversation"><div className="messages" ref={messageScroll} onScroll={() => { const el = messageScroll.current; if (el) { followStream.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; setAwayFromBottom(!followStream.current); } }}>
        {!runs.length ? <div className="welcome"><span className="welcome-mark">w</span><h1>今天，我们一起完成什么？</h1><p>从一个想法到真正完成。<br/>让 Wisp 帮你处理文件、梳理信息，推进手边的事。</p><div className="suggestions"><button onClick={() => { setDrafts(d => ({ ...d, [selected ?? 'new']: '列出文件' })); chooseWorkspace(); }}><WorkspaceIcon name="folder"/><strong>看看我的工作目录</strong><small>授权后浏览和阅读本地文件</small></button><button onClick={() => { dispatchPreview({type: 'open', id: `web:${crypto.randomUUID()}`, target: {kind: 'web', url: ''}}); setPanel(true); }}><WorkspaceIcon name="globe"/><strong>打开一个网页</strong><small>在侧面查看你选择的链接</small></button></div></div> : runs.map(runId => {
          const run = events.filter(e => e.runId === runId), start = run.find(e => e.type === 'started'), terminal = run.findLast(e => ['completed', 'failed', 'cancelled'].includes(e.type));
          const steps = [...new Set(run.filter(e => e.type === 'assistant' || e.type === 'assistant_delta').map(e => Number(e.data.step ?? 0)))];
          const {answers} = groupExecution(run);
          const pending = run.filter(e => e.type === 'approval_requested' && !run.some(n => n.type === 'approval_resolved' && n.data.callId === e.data.id));
          return <div className="turn" key={runId}><div className="user-message">{String(start?.data.prompt ?? '')}</div><div className="assistant-message"><span className="assistant-mark">w</span><div className="assistant-body">

            <ToolActivity events={run} ended={!!terminal} canPreview={connected && !!current?.workspace} previewUnavailableReason={!connected ? '本机服务未连接，连接后可预览文件' : '此会话尚未授权工作目录，授权后可预览文件'} openFile={path => { if (selected && current?.workspace) openPreview({kind:'file',sessionId:selected,workspace:current.workspace,path}); }}/>
            {answers.map((round,index)=><Markdown key={round.step ?? `history-${index}`} text={round.text}/>)}
            {!terminal && pending.map(e => <div className="approval" key={e.id}><div className="approval-title"><WorkspaceIcon name="shield"/> 需要你的批准</div><pre className="approval-description">{String(e.data.description)}</pre><strong>{String(e.data.name)}</strong><pre>{JSON.stringify(e.data.args, null, 2)}</pre><small>仅批准这一次调用。拒绝后不会执行此操作。</small><div><button className="primary" disabled={!connected || approving.includes(String(e.data.id))} onClick={() => void approve(selected!, runId, String(e.data.id), true)}>批准执行</button><button disabled={!connected || approving.includes(String(e.data.id))} onClick={() => void approve(selected!, runId, String(e.data.id), false)}>拒绝</button></div></div>)}
            {terminal && terminal.type !== 'completed' && <div className={`run-notice ${terminal.type}`}><span>{labels[terminal.type]} · {String(terminal.data.reason ?? '')}</span>{runId === runs.at(-1) && <button disabled={!connected || !!active} onClick={() => void action(() => api({ type: 'run.retry', sessionId: selected!, }))}>重试</button>}</div>}
            {terminal?.type === 'completed' && <div className="message-actions"><span><WorkspaceIcon name="check"/> 已完成</span><button onClick={() => void action(async () => { await copyText(run.filter(e => e.type === 'assistant').map(e => String(e.data.text)).join('\n'), window.wisp); setCopied(runId); })}><WorkspaceIcon name={copied === runId ? 'check' : 'copy'}/>{copied === runId ? '已复制' : '复制回复'}</button></div>}
            {!terminal && !steps.length && !pending.length && <span className="thinking">正在思考<span>•••</span></span>}
          </div></div></div>;
        })}<div ref={bottom}/></div>
        <div className="composer-area">{connected && (!modelReady || snapshot.credential?.error) && <div className="model-guidance"><span>{snapshot.credential?.error ?? '配置模型后即可开始对话'}</span><button onClick={event => openModal('settings', event.currentTarget)}>前往设置</button></div>}{awayFromBottom && <button className="latest-message" onClick={() => { followStream.current = true; setAwayFromBottom(false); bottom.current?.scrollIntoView({ block: 'end' }); }}><WorkspaceIcon name="down"/> 回到最新消息</button>}{error && <div className="error" role="alert">{error}<button onClick={() => setError('')} aria-label="关闭错误"><WorkspaceIcon name="close"/></button></div>}<form className="composer" onSubmit={e => { e.preventDefault(); void send(); }}><textarea ref={composerInput} aria-label="消息" placeholder={connected ? modelReady ? '给 Wisp 发消息…' : '先在设置中连接模型…' : '连接本机 Host 后开始对话…'} value={prompt} onChange={e => setDrafts(d => ({ ...d, [selected ?? 'new']: e.target.value }))} maxLength={16000} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}/><div className="composer-toolbar"><button type="button" className="workspace-chip" onClick={chooseWorkspace} title={current?.workspace ?? '授权工作目录'}><WorkspaceIcon name="plus"/><span>{current?.workspace ? current.workspace.split(/[\\/]/).at(-1) : '授权工作目录'}</span></button><div><small>{snapshot.config?.provider === 'offline' ? '离线验证 · 真实文件工具' : '每项任务最多 8 步'}</small>{active ? <button type="button" className="send" aria-label="取消执行" onClick={() => void action(() => api({ type: 'run.cancel', sessionId: selected!, runId: active }))}><WorkspaceIcon name="stop"/></button> : <button className="send" aria-label="发送" disabled={!connected || !modelReady || !prompt.trim() || busy}><WorkspaceIcon name="up"/></button>}</div></div></form><p className="composer-footnote">{current?.workspace ? `${current.projectId ? '继承项目目录权限' : '仅访问此会话授权的目录'}。文件写入始终需要你的批准。` : '你的文件与执行过程保留在本机。模型可能会出错，请核对重要结果。'}</p></div>
      </main>


      </div>
    </div>
    </SplitWorkspace>
    {modal && <div className="modal-backdrop" onClick={closeModal}><section ref={modalElement} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-label="授权目录" onClick={e => e.stopPropagation()}><div className="modal-heading"><h2>授权工作目录</h2><button className="icon" aria-label="关闭弹窗" disabled={modalPending} onClick={closeModal}><WorkspaceIcon name="close"/></button></div>
      <div className="modal-body">
      {modalPending && <p className="modal-pending" role="status">正在处理，请稍候…</p>}<fieldset disabled={modalPending} aria-busy={modalPending}>
      {error && <div className="error" role="alert">{error}<button onClick={() => setError('')} aria-label="关闭错误"><WorkspaceIcon name="close"/></button></div>}
      <form onSubmit={e => { e.preventDefault(); void modalAction(async () => { await api({ type: 'workspace.grant', sessionId: selected!, path: workspace, confirmed: true }); setModal(undefined); dispatchPreview({type: 'open', target: {kind: 'workspace'}}); setPanel(true); }); }}><p className="modal-intro">授权给当前会话“{current?.title}”。Wisp 可以浏览和读取这个目录，写入仍需单独批准。不会执行任意 shell 命令。</p><label>本机绝对路径<input required value={workspace} onChange={e => setWorkspace(e.target.value)} placeholder="/Users/you/Documents/project"/></label>{window.wisp?.chooseDirectory && <button type="button" onClick={() => void modalAction(async () => { const path = await window.wisp!.chooseDirectory(); if (path) setWorkspace(path); })}>选择文件夹…</button>}<p className="settings-note">隐藏文件、符号链接、目录逃逸与 Wisp 私有数据目录禁止访问。最多预览 2 MB 文件。</p><div className="modal-actions"><button className="primary" disabled={!connected || !selected || !!active}>确认授权此目录</button></div></form>
      </fieldset></div>
    </section></div>}
  </div>{settingsOpen && <SettingsPage initialSection={settingsSection} snapshot={snapshot} connected={connected} sessionId={selected} request={api} onBack={() => setSettingsOpen(false)} onRetry={() => setConnectionAttempt(value => value + 1)} onConnect={async value => { let token = value.trim(); try { const url = new URL(token); token = new URLSearchParams(url.hash.slice(1)).get('connect') ?? token; } catch {} if (!token) throw new Error('请输入连接令牌'); const client = webBridge(token); await client.request({type:'snapshot'}); setBridge(client); }}/>}</LinkConfirmationProvider>;
}
