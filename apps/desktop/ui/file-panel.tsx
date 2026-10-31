import React, { useEffect, useRef, useState } from 'react';
import type { FileEntry, FilePreview, Request, Result } from '@wisp/core';
import type { LinkSource } from './preview-model.js';
import { WorkspaceIcon } from './workspace-icon.js';
import { Markdown } from './markdown.js';

const displayLimit = 100_000;
export function FileContents({ file, source }: { file: FilePreview; source?: LinkSource }) {
  if (file.kind === 'image') return <img src={file.dataUrl} alt={file.path}/>;
  if (file.text === undefined) return <p className="file-status">此文件格式暂不支持预览。</p>;
  if (!file.text.length) return <p className="file-status">这是一个空文件。</p>;
  const text = file.text.slice(0, displayLimit);
  return <>{file.text.length > displayLimit && <p className="file-status" role="status">仅展示前 100,000 个字符，后续内容已截断；请使用本地编辑器查看完整文件。</p>}
    {file.kind === 'markdown' ? <Markdown text={text} source={source}/> : <pre className="plain-text">{text}</pre>}</>;
}

export function FilePanel({ sessionId, workspace, connected, active, request, chooseWorkspace, filePath, onOpenFile }: {
  sessionId?: string; workspace?: string; connected: boolean; active: boolean;
  request(request: Request): Promise<Result>; chooseWorkspace(): void; filePath?: string; onOpenFile?(path: string): void;
}) {
  const [path, setPath] = useState(''), [entries, setEntries] = useState<FileEntry[]>([]), [file, setFile] = useState<FilePreview>();
  const [loading, setLoading] = useState<'list' | 'read'>(), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false), [newFile, setNewFile] = useState(false), [text, setText] = useState(''), [saving, setSaving] = useState(false);
  const sequence = useRef(0), live = useRef(true), requestRef = useRef(request); requestRef.current = request;
  // The parent keys this panel by session + authorized directory, resetting all private state.
  useEffect(() => { live.current = true; return () => { live.current = false; sequence.current++; }; }, []);
  const current = (id: number) => live.current && id === sequence.current;
  async function list(nextPath = path) {
    if (!sessionId || !workspace || !connected) return;
    const id = ++sequence.current; setLoading('list'); setError(''); setNotice(''); setFile(undefined); setEditing(false); setNewFile(false); setEntries([]);
    try {
      const result = await requestRef.current({ type: 'files.list', sessionId, path: nextPath });
      if (current(id)) { setEntries(result.entries ?? []); setPath(nextPath); }
    } catch (e) { if (current(id)) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (current(id)) setLoading(undefined); }
  }
  async function read(nextPath: string) {
    if (!sessionId || !connected) return;
    const id = ++sequence.current; setLoading('read'); setError(''); setNotice(''); setFile(undefined); setEditing(false); setNewFile(false);
    try {
      const result = await requestRef.current({ type: 'files.read', sessionId, path: nextPath });
      if (current(id)) { if (!result.file) throw new Error('Host 未返回文件预览'); setFile(result.file); }
    } catch (e) { if (current(id)) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (current(id)) setLoading(undefined); }
  }
  useEffect(() => { if (connected) { if (filePath !== undefined) void read(filePath); else void list(''); } else { sequence.current++; setLoading(undefined); setSaving(false); } }, [connected, filePath]);
  async function save() {
    if (!file || !sessionId || saving || active || !connected) return;
    const id = ++sequence.current; setSaving(true); setError('');
    try {
      await requestRef.current({ type: 'files.write', sessionId, path: file.path, content: text });
      if (current(id)) { setEditing(false); setFile(undefined); setNotice('写入已提交审批。请在对话中批准；批准完成后刷新目录查看文件。'); }
    } catch (e) { if (current(id)) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (current(id)) setSaving(false); }
  }
  const editable = file?.text !== undefined && file.text.length <= displayLimit && new TextEncoder().encode(file.text).length <= 200000;
  return <>
    <div className="file-toolbar">{filePath === undefined ? <>
      <button disabled={!connected || active || saving} onClick={chooseWorkspace}>{workspace ? '更换目录' : '授权目录'}</button>
      {workspace && <><button disabled={!connected || saving} onClick={() => void (filePath !== undefined ? read(filePath) : list())}>刷新</button>
        <button disabled={!connected || active || saving} onClick={() => { sequence.current++; setLoading(undefined); setError(''); setNotice(''); setFile({ path: path ? `${path}/notes.md` : 'notes.md', kind: 'markdown', text: '', size: 0 }); setText(''); setNewFile(true); setEditing(true); }}>新建</button>
        <button disabled={!connected || active || saving} onClick={() => { if (sessionId) void requestRef.current({ type: 'workspace.revoke', sessionId }).catch(e => { if (live.current) setError(String(e)); }); }}>撤销授权</button></>}
    </> : <><WorkspaceIcon name="file"/><span className="file-location" title={filePath}>{filePath}</span>{editable && !editing && <button disabled={!connected || active} onClick={() => { setEditing(true); setText(file.text!); }}><WorkspaceIcon name="edit"/>编辑</button>}<button aria-label="刷新文件" title="刷新文件" disabled={!connected || saving} onClick={() => void read(filePath)}><WorkspaceIcon name="refresh"/></button></>}</div>
    {!workspace ? <div className="panel-empty"><span><WorkspaceIcon name="folder"/></span><h3>让文件成为上下文</h3><p>选择一个你允许 Wisp 访问的文件夹。授权仅属于当前会话，可随时撤销。</p></div> : <>
      {!connected && <p className="file-status">Host 已断开，文件操作暂不可用。</p>}
      {error && <div className="error" role="alert">{error}</div>}{notice && <p className="file-status" role="status">{notice}</p>}
      {filePath === undefined && <><div className="breadcrumb"><button disabled={!connected || saving} onClick={() => void list('')}>根目录</button><span> / {path}</span>{path && <button disabled={!connected || saving} onClick={() => void list(path.split('/').slice(0, -1).join('/'))}>↑ 上一级</button>}</div>
      {loading === 'list' && <p className="file-status" role="status">正在读取目录…</p>}
      <div className="file-list" aria-label="目录文件">{entries.map(entry => <button key={entry.path} disabled={!connected || saving} aria-pressed={file?.path === entry.path} onClick={() => void (entry.kind === 'directory' ? list(entry.path) : onOpenFile ? onOpenFile(entry.path) : read(entry.path))}><WorkspaceIcon name={entry.kind === 'directory' ? 'folder' : 'file'}/><span title={entry.name}>{entry.name}</span><small>{entry.kind === 'file' ? `${entry.size} B` : '›'}</small></button>)}{!entries.length && !loading && !error && <p>此目录没有可显示的文件。</p>}</div>
      </>}{loading === 'read' && <p className="file-status" role="status">正在读取文件…</p>}
      {file && <div className={`file-preview file-preview-${file.kind} ${editing ? 'is-editing' : ''}`}>{filePath === undefined && <div className="preview-title"><strong>{file.path}</strong>{editable && !editing && <button disabled={!connected || active} onClick={() => { setEditing(true); setText(file.text!); }}><WorkspaceIcon name="edit"/>编辑</button>}</div>}
        {editing ? <><p className="file-status">{newFile ? '新文件，尚未保存。' : '修改将以 UTF-8 保存。'}写入需要在对话中审批。</p><label>相对文件路径<input disabled={saving} value={file.path} onChange={e => setFile({ ...file, path: e.target.value })}/></label>
          <textarea className="file-editor" aria-label="文件内容" disabled={saving} value={text} onChange={e => setText(e.target.value)}/>
          <button className="primary" disabled={!connected || active || saving || !file.path.trim()} onClick={() => void save()}>{saving ? '正在提交…' : '提交写入审批'}</button>
          <button disabled={saving} onClick={() => { setEditing(false); if (newFile) setFile(undefined); }}>放弃编辑</button></> : <><FileContents file={file} source={sessionId && workspace ? { kind: 'file', sessionId, workspace, path: file.path } : undefined}/>{file.text !== undefined && !editable && <p className="file-status">此文件超出面板编辑限制，请使用本地编辑器。</p>}</>}
      </div>}
    </>}
  </>;
}
