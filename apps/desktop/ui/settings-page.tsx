import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ModelConfig, ModelInfo, Request, Result, Snapshot } from '@wisp/core';
import { WorkspaceIcon } from './workspace-icon.js';
import './settings-page.css';
import { McpSettings } from './mcp-settings.js';

const defaults: ModelConfig = { provider: 'deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com' };
export function SettingsPage({ initialSection = 'model', snapshot, connected, sessionId, request, onBack, onConnect, onRetry }: {
  initialSection?: 'model'|'connection'|'mcp'; snapshot: Snapshot; connected: boolean; sessionId?: string;
  request(input: Request): Promise<Result>; onBack(): void; onConnect(token: string): Promise<void>; onRetry(): void;
}) {
  const [section, setSection] = useState<'model'|'connection'|'mcp'>(initialSection);
  const [config, setConfig] = useState<ModelConfig>(() => ({ ...snapshot.config ?? defaults }));
  const [apiKey, setApiKey] = useState(''), [remember, setRemember] = useState(true), [token, setToken] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]), [pending, setPending] = useState(false);
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [confirmLeave, setConfirmLeave] = useState(false);
  const saved = useRef({ config: { ...snapshot.config ?? defaults }, remember: true });
  const lock = useRef(false), page = useRef<HTMLElement>(null), confirm = useRef<HTMLElement>(null);
  const restore = useRef<{ element: HTMLElement; moved: boolean; cleanup(): void } | null>(null);
  useLayoutEffect(() => {
    if (pending || !restore.current) return;
    const previous = restore.current; restore.current = null; previous.cleanup();
    if (!previous.moved && previous.element.isConnected && !previous.element.matches(':disabled') && (document.activeElement === document.body || document.activeElement === document.documentElement || document.activeElement === previous.element)) previous.element.focus();
  }, [pending]);
  useEffect(() => () => restore.current?.cleanup(), []);
  const [mcpDirty,setMcpDirty] = useState(false);
  const dirty = mcpDirty || JSON.stringify(config) !== JSON.stringify(saved.current.config) || remember !== saved.current.remember || !!apiKey || !!token;
  const running = snapshot.sessions.some(session => !!session.activeRunId);
  const simulator = snapshot.config?.model === 'wisp-dev-simulator';
  const editable = connected && !running && !simulator;
  const official = config.provider === 'deepseek' && /^https:\/\/api\.deepseek\.com(?:\/v1)?\/?$/.test(config.baseUrl);
  const task = async (work: () => Promise<void>) => {
    if (lock.current) return;
    const element = document.activeElement;
    if (element instanceof HTMLButtonElement && page.current?.contains(element)) {
      const previous = { element, moved: false, cleanup: () => {} };
      const moved = (event: Event) => { if (event.type !== 'focusin' || (event.target !== document.body && event.target !== document.documentElement && event.target !== element)) previous.moved = true; };
      document.addEventListener('focusin', moved); document.addEventListener('pointerdown', moved); document.addEventListener('keydown', moved);
      previous.cleanup = () => { document.removeEventListener('focusin', moved); document.removeEventListener('pointerdown', moved); document.removeEventListener('keydown', moved); };
      restore.current = previous;
    }
    lock.current = true; setPending(true); setError(''); setStatus('');
    try { await work(); } catch (e) { setStatus(''); setError(e instanceof Error ? e.message : String(e)); }
    finally { lock.current = false; setPending(false); }
  };
  const save = async () => {
    if (!editable) throw new Error(running ? '请等待所有任务结束后修改模型配置' : '当前无法修改模型配置');
    try {
      await request({ type: 'model.save', config, rememberKey: remember && official && snapshot.credential?.storage === 'secure', ...(apiKey ? { apiKey } : {}) });
      saved.current = { config: { ...config }, remember }; setStatus('设置已保存');
    } finally { setApiKey(current => current === apiKey ? '' : current); }
  };
  const back = () => { if (lock.current) return; if (dirty) setConfirmLeave(true); else onBack(); };
  useEffect(() => { page.current?.focus(); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (!lock.current) { if (confirmLeave) setConfirmLeave(false); else back(); } }
    };
    document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true);
  }, [dirty, confirmLeave, onBack]);
  useEffect(() => {
    if (!confirmLeave) return;
    const previous = document.activeElement as HTMLElement;
    confirm.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const targets = Array.from(confirm.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []), first = targets[0], last = targets.at(-1);
      if (!first) { e.preventDefault(); confirm.current?.focus(); }
      else if (e.shiftKey && (document.activeElement === first || !confirm.current?.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !confirm.current?.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trap); return () => { document.removeEventListener('keydown', trap); if (previous.isConnected) previous.focus(); };
  }, [confirmLeave]);
  const feedback = <div className="settings-feedback" aria-live="polite" aria-atomic="true">{pending ? <p role="status">正在处理，请稍候…</p> : error ? <p className="error" role="alert">{error}</p> : dirty ? <p role="status">有未保存的更改</p> : status ? <p role="status">{status}</p> : null}</div>;
  return <main className="settings-page" ref={page} tabIndex={-1} aria-label="设置页面">
    <aside className="settings-navigation" inert={confirmLeave}>
      <button className="settings-back" onClick={back} disabled={pending}><WorkspaceIcon name="back"/>返回工作台</button><h1>设置</h1>
      <nav aria-label="设置分类"><button aria-current={section === 'model' ? 'page' : undefined} onClick={() => setSection('model')}><WorkspaceIcon name="model"/>模型</button><button aria-current={section === 'connection' ? 'page' : undefined} onClick={() => setSection('connection')}><WorkspaceIcon name="workspace"/>本机连接</button><button aria-current={section === 'mcp' ? 'page' : undefined} onClick={() => setSection('mcp')}><WorkspaceIcon name="settings"/>本地 MCP</button></nav>
    </aside>
    <div className="settings-scroll" inert={confirmLeave}><div className="settings-content">
      <header><h2>{section === 'model' ? '模型' : section === 'mcp' ? '本地 MCP' : '本机连接'}</h2><p>{section === 'model' ? '管理模型与 API 凭据。由本机直接访问你配置的服务。' : section === 'mcp' ? '管理自定义服务及可供对话调用的工具。' : '查看工作台与本机服务的连接状态。'}</p></header>
      <section hidden={section !== 'model'}>
        {!connected && <p className="settings-note">本机服务未连接，连接后可保存设置。</p>}{running && <p className="settings-note">有任务正在运行，结束后即可修改配置。</p>}{simulator && <p className="settings-note">开发模拟使用固定假凭据，不接受真实 Key。退出模拟后运行普通工作台才能配置。</p>}
        <form onSubmit={e => { e.preventDefault(); if (editable) void task(save); }}>
          <fieldset disabled={pending || !editable} aria-busy={pending}>
            <h3>服务</h3><div className="settings-group">
              <label className="settings-row"><span>提供商<small>切换提供商需要分别配置凭据</small></span><select value={config.provider} onChange={e => { const provider = e.target.value as ModelConfig['provider']; setConfig({ provider, model: provider === 'deepseek' ? 'deepseek-flash' : provider === 'offline' ? 'offline-test' : '', baseUrl: provider === 'deepseek' ? 'https://api.deepseek.com' : provider === 'offline' ? '' : 'https://api.openai.com/v1' }); setApiKey(''); setModels([]); setStatus(''); }}><option value="deepseek">DeepSeek</option><option value="openai-compatible">OpenAI 兼容接口</option><option value="offline">离线验证（开发诊断）</option></select></label>
              {config.provider !== 'offline' && <><label className="settings-row"><span>模型名称<small>填写服务支持的模型 ID</small></span><input list="settings-model-options" required value={config.model} onChange={e => setConfig({ ...config, model: e.target.value })}/><datalist id="settings-model-options">{models.map(model => <option key={model.id} value={model.id}>{model.name ?? model.id}</option>)}</datalist></label><label className="settings-row"><span>API 地址<small>修改地址不会转发已保存的 Key</small></span><input type="url" required value={config.baseUrl} onChange={e => setConfig({ ...config, baseUrl: e.target.value })}/></label></>}
            </div>
            {config.provider !== 'offline' ? <><h3>凭据</h3><div className="settings-group"><label className="settings-row"><span>API Key<small>{snapshot.keyPresent ? snapshot.credential?.saved ? '已安全保存 · 留空保留' : '当前会话已配置 · 留空保留' : '尚未配置'}</small></span><input type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="输入新 Key，不回显已保存内容"/></label>{snapshot.credential?.storage === 'secure' && config.provider === 'deepseek' && <label className="settings-row"><span>保存新 Key<small>{official ? '使用系统安全存储，重启后可用' : '仅官方 API 支持；当前地址仅会话保存'}</small></span><input type="checkbox" checked={remember && official} disabled={!official} onChange={e => setRemember(e.target.checked)}/></label>}{(snapshot.keyPresent || snapshot.credential?.saved || snapshot.credential?.error) && <div className="settings-row"><span>删除凭据<small>清除本地保存与内存中的 Key</small></span><button type="button" onClick={() => void task(async () => { await request({type:'model.clearKey'}); setApiKey(''); setStatus('Key 已删除'); })}>删除 Key</button></div>}</div>
            {snapshot.credential?.error && <p className="error">{snapshot.credential.error}</p>}<p className="settings-note">{snapshot.credential?.storage === 'secure' ? '新 Key 仅在勾选保存且使用官方 API 时持久保存，否则仅当前进程使用。留空保留已有 Key；如需移除已保存凭据，请使用删除 Key。' : '此 Web/会话环境不提供系统钥匙串，Key 仅在本次进程内使用，重启需重新输入。'}</p>
            {config.provider === 'deepseek' && <><h3>思考</h3><div className="settings-group"><label className="settings-row"><span>思考模式</span><select value={config.thinking ?? 'enabled'} onChange={e => setConfig({...config,thinking:e.target.value as 'enabled'|'disabled'})}><option value="enabled">开启</option><option value="disabled">关闭</option></select></label>{config.thinking !== 'disabled' && <label className="settings-row"><span>思考强度</span><select value={config.effort ?? 'high'} onChange={e => setConfig({...config,effort:e.target.value as 'low'|'high'|'max'})}>{(models.find(model=>model.id===config.model)?.effort?.supportedLevels ?? ['low','high','max']).map(level=><option key={level} value={level}>{level}</option>)}</select></label>}</div></>}
            <p className="settings-note">保存不会发起生成请求。发送任务时，消息及工具读取结果会传给配置的 API。</p></> : <p className="settings-note">开发诊断，不生成模型答案。支持“列出文件”“读取 文件名”“写入 文件名 + 换行 + 内容”；执行的是真实本地工具，写入仍需批准。</p>}
          </fieldset>
          {feedback}
            <div className="settings-actions"><button type="button" className="settings-cancel" disabled={pending} onClick={back}>取消并返回</button>{config.provider !== 'offline' && <button type="button" disabled={pending || !editable} onClick={e => { if (!e.currentTarget.form?.reportValidity()) return; void task(async () => { await save(); setStatus('正在查询可用模型…'); const result = await request({type:'model.list'}); setModels(result.models ?? []); setStatus(`设置已保存，找到 ${result.models?.length ?? 0} 个模型`); }); }}>保存并查询模型</button>}<button className="primary" type="submit" disabled={pending || !editable}>保存设置</button></div>
        </form>
      </section>
      <section hidden={section !== 'connection'}><h3>工作台</h3><div className="settings-group"><div className="settings-row"><span>本机服务<small>任务与文件访问在你的电脑上执行</small></span><strong>{connected ? '已连接' : '未连接'}</strong></div></div>
        {!connected && (window.wisp ? <button className="settings-reconnect" disabled={pending} onClick={onRetry}>重新连接</button> : <form className="settings-connect" onSubmit={e => {e.preventDefault();void task(async()=>{await onConnect(token);setToken(current => current === token ? '' : current);setStatus('本机服务已连接');});}}><p className="settings-note">在本机运行 pnpm web 后使用终端给出的链接。托管预览不能连接你电脑的 localhost；令牌仅存在内存。</p><label>同源 Host 连接令牌<input type="password" autoComplete="off" required value={token} onChange={e=>setToken(e.target.value)}/></label><button disabled={pending} className="primary">连接</button></form>)}
        {feedback}
      </section>
      <div hidden={section !== 'mcp'}><McpSettings servers={snapshot.mcpServers??[]} connected={connected} request={request} onDirty={setMcpDirty}/></div>
    </div></div>
    {confirmLeave && <div className="modal-backdrop"><section ref={confirm} tabIndex={-1} className="modal" role="alertdialog" aria-modal="true" aria-labelledby="settings-unsaved-title"><div className="modal-heading"><h2 id="settings-unsaved-title">有尚未保存的更改</h2></div><div className="modal-body"><p>离开会放弃未保存的配置与输入的凭据。</p><div className="modal-actions"><button disabled={pending} onClick={()=>setConfirmLeave(false)}>继续编辑</button><button disabled={pending} onClick={onBack}>放弃更改并返回</button></div></div></section></div>}
  </main>;
}
