import React, { useEffect, useRef, useState } from 'react';
import type { WorkbenchBridge, Request, Snapshot, RunEvent, ModelConfig, ModelInfo, Result } from '@wisp/core';
import { webBridge } from './bridge.js';
import { copyText } from './clipboard.js';
import { Markdown } from './markdown.js';
import { FilePanel } from './file-panel.js';
import './style.css';
declare global { interface Window { wisp?: WorkbenchBridge & { copyText(text: string): Promise<void>; chooseDirectory(): Promise<string | undefined>; openUrl(url: string): Promise<void> } } }
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
  const [panel, setPanel] = useState<'files' | 'web' | undefined>(), [modal, setModal] = useState<'settings' | 'workspace' | 'connect' | undefined>(), [sidebar, setSidebar] = useState(false);
  const [config, setConfig] = useState<ModelConfig>({ provider: 'deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com' }), [apiKey, setApiKey] = useState(''), [connection, setConnection] = useState('');
  const [rememberKey, setRememberKey] = useState(true);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [webInput, setWebInput] = useState(''), [webUrl, setWebUrl] = useState(''), [copied, setCopied] = useState('');
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const approvalLocks = useRef(new Set<string>()), [approving, setApproving] = useState<string[]>([]);
  const bottom = useRef<HTMLDivElement>(null), messageScroll = useRef<HTMLDivElement>(null), followStream = useRef(true), modalElement = useRef<HTMLElement>(null);
  const current = snapshot.sessions.find(s => s.id === selected), events = snapshot.events.filter(e => e.sessionId === selected);
  const prompt = drafts[selected ?? 'new'] ?? '', active = current?.activeRunId;
  const modelReady = !!snapshot.config && (snapshot.config.provider === 'offline' || snapshot.keyPresent);
  const api = async (request: Request): Promise<Result> => { if (!bridge || !connected) throw new Error('本机 Host 未连接'); return bridge.request(request); };
  const action = async (task: () => Promise<unknown>) => { setError(''); try { return await task(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
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
        setSelected(value => value && next.sessions.some(s => s.id === value) ? value : next.selectedId);
        setConnected(true); setError('');
      } catch (e) { if (live && revision === generation) { setError(String(e)); setConnected(false); } }
    }
    const unsubscribe = bridge.subscribe(notice => {
      if (!live) return;
      if (notice.type === 'disconnected') { generation++; setConnected(false); setError(notice.message); }
      if (notice.type === 'changed') void refresh();
      if (notice.type === 'event') {
        const e = notice.event;
        setSnapshot(s => ({ ...s, events: s.events.some(old => old.id === e.id) ? s.events : [...s.events, e], sessions: s.sessions.map(session => session.id !== e.sessionId ? session : { ...session, updatedAt: e.at, activeRunId: e.type === 'started' ? e.runId : ['completed', 'failed', 'cancelled'].includes(e.type) ? undefined : session.activeRunId }) }));
      }
    });
    void refresh();
    return () => { live = false; generation++; unsubscribe(); };
  }, [bridge, connectionAttempt]);
  useEffect(() => { followStream.current = true; setAwayFromBottom(false); bottom.current?.scrollIntoView({ block: 'end' }); }, [selected]);
  useEffect(() => { if (followStream.current) bottom.current?.scrollIntoView({ block: 'end' }); }, [events.length]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = modalElement.current;
    const elements = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? []);
    elements()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const targets = elements(), first = targets[0], last = targets.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus(); };
  }, [modal]);
  useEffect(() => { setWorkspace(current?.workspace ?? ''); }, [selected, current?.workspace]);
  useEffect(() => { if (snapshot.config) setConfig(snapshot.config); }, [snapshot.config?.provider, snapshot.config?.model, snapshot.config?.baseUrl]);
  const newSession = () => action(async () => { const result = await api({ type: 'session.create', title: '新会话' }); setSelected(result.sessionId); setSidebar(false); });
  const select = (id: string) => { setSelected(id); setSidebar(false); void action(() => api({ type: 'session.select', sessionId: id })); };
  const send = async () => {
    if (!connected || !modelReady || !prompt.trim() || active || busy) return;
    const originalPrompt = prompt, savedPrompt = prompt.trim(), original = selected ?? 'new'; setBusy(true);
    await action(async () => {
      let id = selected;
      if (!id) id = (await api({ type: 'session.create', title: savedPrompt.slice(0, 30) })).sessionId;
      if (!id) throw new Error('创建会话失败');
      if ((selectedRef.current ?? 'new') === original) setSelected(id);
      await api({ type: 'run.start', sessionId: id, prompt: savedPrompt, maxSteps: 8 });
      if (current?.title === '新会话') await api({ type: 'session.rename', sessionId: id, title: savedPrompt.slice(0, 30) });
      setDrafts(d => d[original] === originalPrompt ? { ...d, [original]: '' } : d);
    }); setBusy(false);
  };
  const approve = async (sessionId: string, runId: string, callId: string, allowed: boolean) => {
    if (approvalLocks.current.has(callId)) return;
    approvalLocks.current.add(callId); setApproving(Array.from(approvalLocks.current));
    try { await action(() => api({ type: 'run.approve', sessionId, runId, callId, allowed })); }
    finally { approvalLocks.current.delete(callId); setApproving(Array.from(approvalLocks.current)); }
  };
  const showFiles = () => setPanel(panel === 'files' ? undefined : 'files');
  const chooseWorkspace = () => { if (!selected) { setError('请先新建一个会话，再授权目录'); return; } setWorkspace(current?.workspace ?? ''); setModal('workspace'); };
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); if (connected && !modal) void newSession(); }
      if (event.key === 'Escape') { setModal(undefined); setApiKey(''); setSidebar(false); }
    };
    window.addEventListener('keydown', shortcuts); return () => window.removeEventListener('keydown', shortcuts);
  }, [connected, bridge, modal]);
  const runs = [...new Set(events.map(e => e.runId))];
  const openUrl = () => { try { const url = new URL(webInput); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(); setWebUrl(url.href); setError(''); } catch { setError('请输入不含凭据的 HTTP 或 HTTPS 链接'); } };
  return <div className={`workbench ${sidebar ? 'sidebar-visible' : ''}`}>
    <aside className="sidebar"><div className="brand"><span className="mark">w</span><strong>Wisp</strong><button className="icon mobile" onClick={() => setSidebar(false)} aria-label="关闭侧栏">×</button></div>
      <button className="new-chat" onClick={() => void newSession()} disabled={!connected}><span>＋</span> 新对话 <kbd>⌘ N</kbd></button>
      <div className="sidebar-label">会话</div><nav>{snapshot.sessions.map(session => <button aria-current={session.id === selected ? 'page' : undefined} className={`session ${session.id === selected ? 'selected' : ''}`} key={session.id} onClick={() => select(session.id)} disabled={!connected}><span className="session-title">{session.title}</span>{session.activeRunId ? <span className="pulse" title="执行中"/> : <small>{new Date(session.updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</small>}</button>)}{!snapshot.sessions.length && <p className="sidebar-empty">新的想法，从这里开始。<br/>连接 Host 后保存你的会话。</p>}</nav>
      <div className="sidebar-bottom"><button onClick={() => setModal('settings')}><span>⚙</span><span>模型与设置<small>{snapshot.config?.model ?? '尚未配置模型'}</small></span></button><button onClick={() => setModal('connect')}><span className={`connection-dot ${connected ? 'online' : ''}`}/><span>{connected ? '本机 Host 已连接' : '本机 Host 未连接'}<small>{connected ? '数据保存在你的电脑' : '当前仅查看工作台界面'}</small></span></button></div>
    </aside>
    <div className="workspace"><header className="topbar"><div><button className="icon mobile" onClick={() => setSidebar(true)} aria-label="打开侧栏">☰</button><button className="model-button" onClick={() => setModal('settings')}>Wisp <span>{snapshot.config?.provider === 'offline' ? '离线验证' : snapshot.config?.model ?? '选择模型'}</span>⌄</button></div><div className="top-actions"><button className={panel === 'files' ? 'active' : ''} onClick={showFiles}>▱ <span>文件</span></button><button className={panel === 'web' ? 'active' : ''} onClick={() => setPanel(panel === 'web' ? undefined : 'web')}>◎ <span>网页</span></button><button className="icon" onClick={() => setModal('settings')} aria-label="设置">⚙</button></div></header>
      {connected && snapshot.config?.model === 'wisp-dev-simulator' && <div className="connection-banner"><span>开发模拟 · 脚本模型，非真实 DeepSeek；文件工具真实执行，仅用于临时目录验证。</span></div>}
      {!connected && <div className="connection-banner"><span>{window.wisp ? error ? '本机 Host 连接失败，请重试；若 Host 已停止，请重新启动 Wisp。' : '正在连接本机 Host。如出现 Wisp Safe Storage 系统提示，请按需授权读取已保存的 Key；密码仅输入系统弹窗。' : '此界面未连接本机 Host，不能执行任务或读取文件。'}</span>{window.wisp ? <button onClick={() => { setError(''); setConnectionAttempt(value => value + 1); }}>重新连接</button> : <button onClick={() => setModal('connect')}>连接 Host →</button>}</div>}
      {connected && snapshot.credential?.error && <div className="connection-banner"><span>{snapshot.credential.error}</span><button onClick={() => setModal('settings')}>模型与设置 →</button></div>}
      <div className="workspace-body"><main className="conversation"><div className="messages" ref={messageScroll} onScroll={() => { const el = messageScroll.current; if (el) { followStream.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; setAwayFromBottom(!followStream.current); } }}>
        {!runs.length ? <div className="welcome"><span className="welcome-mark">w</span><h1>今天，我们一起完成什么？</h1><p>从一个想法到真正完成。<br/>让 Wisp 帮你处理文件、梳理信息，推进手边的事。</p><div className="suggestions"><button onClick={() => { setDrafts(d => ({ ...d, [selected ?? 'new']: '列出文件' })); chooseWorkspace(); }}><span>▱</span><strong>看看我的工作目录</strong><small>授权后浏览和阅读本地文件</small></button><button onClick={() => { setPanel('web'); }}><span>◎</span><strong>打开一个网页</strong><small>在侧面查看你选择的链接</small></button><button onClick={() => setModal('settings')}><span>◇</span><strong>连接你常用的模型</strong><small>提供商、模型与 API 设置</small></button></div>{!modelReady && <button className="text-button" onClick={() => setModal('settings')}>{snapshot.config ? '设置本次进程的 API Key' : '先配置模型，开始第一段对话'} →</button>}</div> : runs.map(runId => {
          const run = events.filter(e => e.runId === runId), start = run.find(e => e.type === 'started'), terminal = run.findLast(e => ['completed', 'failed', 'cancelled'].includes(e.type));
          const steps = [...new Set(run.filter(e => e.type === 'assistant' || e.type === 'assistant_delta').map(e => Number(e.data.step ?? 0)))];
          const pending = run.filter(e => e.type === 'approval_requested' && !run.some(n => n.type === 'approval_resolved' && n.data.callId === e.data.id));
          return <div className="turn" key={runId}><div className="user-message">{String(start?.data.prompt ?? '')}</div><div className="assistant-message"><span className="assistant-mark">w</span><div className="assistant-body">
            {steps.map(step => { const final = run.find(e => e.type === 'assistant' && Number(e.data.step ?? 0) === step); const text = final ? String(final.data.text) : run.filter(e => e.type === 'assistant_delta' && Number(e.data.step) === step).map(e => String(e.data.text)).join(''); return <Markdown key={step} text={text}/>; })}
            {!!run.filter(e => e.type === 'tool_requested').length && <details className="tool-trace"><summary>{active === runId ? '正在处理' : '执行过程'} · {run.filter(e => e.type === 'tool_requested').length} 次工具调用</summary>{run.filter(e => ['tool_requested', 'tool_result', 'approval_resolved'].includes(e.type)).map(e => <div className="trace-item" key={e.id}><strong>{labels[e.type]} {String(e.data.name ?? '')}</strong><pre>{JSON.stringify(e.data, null, 2)}</pre></div>)}</details>}
            {!terminal && pending.map(e => <div className="approval" key={e.id}><div className="approval-title">◈ 需要你的批准</div><p>{String(e.data.description)}</p><strong>{String(e.data.name)}</strong><pre>{JSON.stringify(e.data.args, null, 2)}</pre><small>仅批准这一次调用。拒绝后不会执行此操作。</small><div><button className="primary" disabled={!connected || approving.includes(String(e.data.id))} onClick={() => void approve(selected!, runId, String(e.data.id), true)}>批准执行</button><button disabled={!connected || approving.includes(String(e.data.id))} onClick={() => void approve(selected!, runId, String(e.data.id), false)}>拒绝</button></div></div>)}
            {terminal && terminal.type !== 'completed' && <div className={`run-notice ${terminal.type}`}><span>{labels[terminal.type]} · {String(terminal.data.reason ?? '')}</span>{runId === runs.at(-1) && <button disabled={!connected || !!active} onClick={() => void action(() => api({ type: 'run.retry', sessionId: selected!, }))}>重试</button>}</div>}
            {terminal?.type === 'completed' && <div className="message-actions"><span>✓ 已完成</span><button onClick={() => void action(async () => { await copyText(run.filter(e => e.type === 'assistant').map(e => String(e.data.text)).join('\n'), window.wisp); setCopied(runId); })}>{copied === runId ? '已复制' : '复制回复'}</button></div>}
            {!terminal && !steps.length && !pending.length && <span className="thinking">正在思考<span>•••</span></span>}
          </div></div></div>;
        })}<div ref={bottom}/></div>
        <div className="composer-area">{awayFromBottom && <button className="latest-message" onClick={() => { followStream.current = true; setAwayFromBottom(false); bottom.current?.scrollIntoView({ block: 'end' }); }}>↓ 回到最新消息</button>}{error && <div className="error" role="alert">{error}<button onClick={() => setError('')} aria-label="关闭错误">×</button></div>}<form className="composer" onSubmit={e => { e.preventDefault(); void send(); }}><textarea aria-label="消息" placeholder={connected ? modelReady ? '给 Wisp 发消息…' : '先在设置中连接模型…' : '连接本机 Host 后开始对话…'} value={prompt} onChange={e => setDrafts(d => ({ ...d, [selected ?? 'new']: e.target.value }))} maxLength={16000} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}/><div className="composer-toolbar"><button type="button" className="workspace-chip" onClick={chooseWorkspace}>＋ {current?.workspace ? current.workspace.split(/[\\/]/).at(-1) : '授权工作目录'}</button><div><small>{snapshot.config?.provider === 'offline' ? '离线验证 · 真实文件工具' : '每项任务最多 8 步'}</small>{active ? <button type="button" className="send" aria-label="取消执行" onClick={() => void action(() => api({ type: 'run.cancel', sessionId: selected!, runId: active }))}>■</button> : <button className="send" aria-label="发送" disabled={!connected || !modelReady || !prompt.trim() || busy}>↑</button>}</div></div></form><p className="composer-footnote">{current?.workspace ? '仅访问此会话授权的目录。文件写入始终需要你的批准。' : '你的文件与执行过程保留在本机。模型可能会出错，请核对重要结果。'}</p></div>
      </main>
      {panel && <aside className="inspector"><div className="inspector-heading"><div><strong>{panel === 'files' ? '工作目录' : '网页预览'}</strong><small>{panel === 'files' ? current?.workspace ?? '尚未授权目录' : '展示网页 · 浏览器自动化未连接'}</small></div><button className="icon" onClick={() => setPanel(undefined)} aria-label="关闭预览">×</button></div>
        {panel === 'files' ? <FilePanel key={`${selected ?? 'none'}:${current?.workspace ?? ''}`} sessionId={selected} workspace={current?.workspace} connected={connected} active={!!active} request={api} chooseWorkspace={chooseWorkspace}/> : <><form className="url-form" onSubmit={e => { e.preventDefault(); openUrl(); }}><input aria-label="网页链接" placeholder="https://example.com" value={webInput} onChange={e => setWebInput(e.target.value)}/><button>打开</button></form><p className="web-note">由你选择的网页直接加载，不代表 Agent 正在浏览。部分网站禁止嵌入；此面板不提供自动点击或读取能力。</p>{webUrl ? <><a className="external-link" onClick={e => { if (window.wisp) { e.preventDefault(); void action(() => window.wisp!.openUrl(webUrl)); } }} href={webUrl} target="_blank" rel="noreferrer noopener">在浏览器新标签页打开 ↗</a><iframe title="用户选择的网页" src={webUrl} sandbox="allow-scripts" referrerPolicy="no-referrer"/></> : <div className="panel-empty"><span>◎</span><h3>留在对话里，查看网页</h3><p>粘贴一个链接。自动化浏览器尚未连接，Wisp 不会假装已读取网页。</p></div>}</>}
      </aside>}
      </div>
    </div>
    {modal && <div className="modal-backdrop" onClick={() => { setModal(undefined); setApiKey(''); }}><section ref={modalElement} className="modal" role="dialog" aria-modal="true" aria-label={modal === 'settings' ? '模型设置' : modal === 'workspace' ? '授权目录' : '连接 Host'} onClick={e => e.stopPropagation()}><div className="modal-heading"><h2>{modal === 'settings' ? '模型与连接' : modal === 'workspace' ? '授权工作目录' : '连接本机 Host'}</h2><button className="icon" aria-label="关闭弹窗" onClick={() => { setModal(undefined); setApiKey(''); }}>×</button></div>
      {error && <div className="error" role="alert">{error}<button onClick={() => setError('')} aria-label="关闭错误">×</button></div>}
      {modal === 'settings' ? <form onSubmit={e => { e.preventDefault(); void action(async () => { try { await api({ type: 'model.save', config, rememberKey: rememberKey && snapshot.credential?.storage === 'secure' && config.provider === 'deepseek' && /^https:\/\/api\.deepseek\.com(?:\/v1)?\/?$/.test(config.baseUrl), ...(apiKey ? { apiKey } : {}) }); setModal(undefined); } finally { setApiKey(''); } }); }}><p className="modal-intro">选择模型来执行真实任务。设置保存在本机。桌面版可用系统安全存储保存 DeepSeek 官方 Key；Web 版仅当前会话有效。</p><label>提供商<select value={config.provider} onChange={e => { const provider = e.target.value as ModelConfig['provider']; setConfig({ provider, model: provider === 'deepseek' ? 'deepseek-flash' : provider === 'offline' ? 'offline-test' : '', baseUrl: provider === 'deepseek' ? 'https://api.deepseek.com' : provider === 'offline' ? '' : 'https://api.openai.com/v1' }); setApiKey(''); setModels([]); }}><option value="deepseek">DeepSeek</option><option value="openai-compatible">OpenAI 兼容接口</option><option value="offline">离线验证（不调用模型）</option></select></label>{config.provider !== 'offline' ? <><label>模型名称<input list="model-options" required value={config.model} onChange={e => setConfig({ ...config, model: e.target.value })} placeholder="模型 ID"/><datalist id="model-options">{models.map(model => <option key={model.id} value={model.id}>{model.name ?? model.id}</option>)}</datalist></label><label>Base URL<input required value={config.baseUrl} onChange={e => setConfig({ ...config, baseUrl: e.target.value })}/></label><label>API Key <small>{snapshot.keyPresent ? (snapshot.credential?.saved ? '•••• 已安全保存；留空保留' : '•••• 本次会话已设置') : '未设置'}</small><input type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} disabled={snapshot.config?.model === 'wisp-dev-simulator'} placeholder="输入 Key；不会回显已保存的内容"/></label>{snapshot.credential?.storage === 'secure' && config.provider === 'deepseek' && <label><input type="checkbox" checked={rememberKey} onChange={e => setRememberKey(e.target.checked)}/>使用系统安全存储（仅官方 API）</label>}{snapshot.credential?.error && <p className="error">{snapshot.credential.error}</p>}{config.provider === 'deepseek' && <><label>思考模式<select value={config.thinking ?? 'enabled'} onChange={e => setConfig({ ...config, thinking: e.target.value as 'enabled' | 'disabled' })}><option value="enabled">开启（官方默认）</option><option value="disabled">关闭</option></select></label>{config.thinking !== 'disabled' && <label>思考强度<select value={config.effort ?? 'high'} onChange={e => setConfig({ ...config, effort: e.target.value as 'low' | 'high' | 'max' })}>{(models.find(m => m.id === config.model)?.effort?.supportedLevels ?? ['low', 'high', 'max']).map(level => <option key={level} value={level}>{level}</option>)}</select></label>}<button type="button" disabled={!connected || busy} onClick={() => void action(async () => { try { await api({ type: 'model.save', config, rememberKey: rememberKey && snapshot.credential?.storage === 'secure' && config.provider === 'deepseek' && /^https:\/\/api\.deepseek\.com(?:\/v1)?\/?$/.test(config.baseUrl), ...(apiKey ? { apiKey } : {}) }); const result = await api({ type: 'model.list' }); setModels(result.models ?? []); } finally { setApiKey(''); } })}>保存并获取可用模型（仅查询）</button></>}<p className="settings-note">保存不会发起模型请求。发送任务时，消息和工具读取结果会传给你配置的 API。{snapshot.credential?.storage === 'secure' ? '安全保存后重启可用；更换地址不会转发已保存 Key。' : '此 Web/会话环境不提供系统钥匙串，重启后需重新输入。'}</p></> : <p className="settings-note">明确启用诊断模式：支持“列出文件”“读取 文件名”“写入 文件名 + 换行 + 内容”。执行的是真实本地工具，但不会生成模型答案。</p>}<div className="connection-card"><span>浏览器自动化</span><strong>未连接</strong><small>网页面板仅展示用户选择的链接，Playwright MCP 尚未配置。</small></div><div className="modal-actions">{(snapshot.keyPresent || snapshot.credential?.saved || snapshot.credential?.error) && <button type="button" onClick={() => void action(() => api({ type: 'model.clearKey' }))}>删除 Key（本地及内存）</button>}<button className="primary" disabled={!connected}>保存设置</button></div></form> : modal === 'workspace' ? <form onSubmit={e => { e.preventDefault(); void action(async () => { await api({ type: 'workspace.grant', sessionId: selected!, path: workspace, confirmed: true }); setModal(undefined); setPanel('files'); }); }}><p className="modal-intro">授权给当前会话“{current?.title}”。Wisp 可以浏览和读取这个目录，写入仍需单独批准。不会执行任意 shell 命令。</p><label>本机绝对路径<input required value={workspace} onChange={e => setWorkspace(e.target.value)} placeholder="/Users/you/Documents/project"/></label>{window.wisp?.chooseDirectory && <button type="button" onClick={() => void action(async () => { const path = await window.wisp!.chooseDirectory(); if (path) setWorkspace(path); })}>选择文件夹…</button>}<p className="settings-note">隐藏文件、符号链接、目录逃逸与 Wisp 私有数据目录禁止访问。最多预览 2 MB 文件。</p><div className="modal-actions"><button className="primary" disabled={!connected || !selected || !!active}>确认授权此目录</button></div></form> : <form onSubmit={e => { e.preventDefault(); void action(async () => { let token = connection.trim(); try { const url = new URL(token); token = new URLSearchParams(url.hash.slice(1)).get('connect') ?? token; } catch {} if (!token) throw new Error('请输入本机 Host 的连接令牌'); const client = webBridge(token); await client.request({ type: 'snapshot' }); setBridge(client); setConnection(''); setModal(undefined); }); }}><p className="modal-intro">在你的电脑运行 Wisp，再打开终端给出的本机链接。此界面不会连接云端执行环境。</p><pre className="start-command">pnpm web</pre><p className="settings-note">本地 Web 与 Host 同源，默认端口 5180。连接令牌只放在页面内存，不保存到浏览器存储。托管预览不能访问你电脑的 localhost。</p><label>同源 Host 连接令牌<input type="password" autoComplete="off" value={connection} onChange={e => setConnection(e.target.value)} placeholder="粘贴终端连接链接或令牌"/></label><div className="modal-actions"><button className="primary">连接</button></div></form>}
    </section></div>}
  </div>;
}
