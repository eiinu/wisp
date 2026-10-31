import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ProjectInfo, Request, Result, SessionInfo } from '@wisp/core';
import { WorkspaceIcon } from './workspace-icon.js';

export function ProjectSidebar({ projects, sessions, selected, connected, request, select, openDirectory, onDialogChange, chooseDirectory }: {
  projects: ProjectInfo[]; sessions: SessionInfo[]; selected?: string; connected: boolean;
  request(input: Request): Promise<Result>; select(id: string): void; openDirectory(id: string): void;
  onDialogChange(open: boolean): void; chooseDirectory?(): Promise<string | undefined>;
}) {
  const [dialog, setDialog] = useState<'create' | ProjectInfo>(), [name, setName] = useState(''), [path, setPath] = useState('');
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const lock = useRef(false), generation = useRef(0), modal = useRef<HTMLElement>(null);
  useEffect(() => { onDialogChange(!!dialog); return () => onDialogChange(false); }, [!!dialog, onDialogChange]);
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement;
    const focusable = () => Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? []);
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !lock.current) { event.stopImmediatePropagation(); setDialog(undefined); generation.current++; }
      if (event.key === 'Tab') { const items = focusable(), first = items[0], last = items.at(-1); if (event.shiftKey && (document.activeElement === first || !modal.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && (document.activeElement === last || !modal.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); } }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); if (previous?.isConnected) previous.focus(); };
  }, [dialog]);
  async function perform(task: () => Promise<void>) {
    if (lock.current || !connected) return;
    lock.current = true; setPending(true); setError('');
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { lock.current = false; setPending(false); }
  }
  const close = () => { if (!lock.current) { generation.current++; setDialog(undefined); setError(''); } };
  const edit = (project?: ProjectInfo) => { generation.current++; setName(project?.name ?? ''); setPath(project?.workspace ?? ''); setError(''); setDialog(project ?? 'create'); };
  async function createSession(project: ProjectInfo, directory = false) {
    await perform(async () => {
      const existing = directory ? sessions.find(s => s.id === selected && s.projectId === project.id) ?? sessions.find(s => s.projectId === project.id) : undefined;
      const id = existing?.id ?? (await request({ type: 'session.create', projectId: project.id, title: '新会话' })).sessionId;
      if (!id) throw new Error('创建会话失败');
      if (directory) openDirectory(id); else select(id);
    });
  }
  const sessionButtons = (items: SessionInfo[]) => items.map(session => <button aria-current={session.id === selected ? 'page' : undefined} className={`session ${session.id === selected ? 'selected' : ''}`} key={session.id} onClick={() => select(session.id)} disabled={!connected}><span className="session-title">{session.title}</span>{session.activeRunId ? <span className="pulse" title="执行中"/> : <small>{new Date(session.updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</small>}</button>);
  return <>
    <nav className="project-navigation" aria-label="项目与会话">
      <div className="project-section-heading"><span>项目</span><button aria-label="新建项目" title="新建项目" disabled={!connected || pending} onClick={() => edit()}><WorkspaceIcon name="plus"/></button></div>
      {projects.map(project => <section className="project-group" key={project.id}>
        <div className="project-row"><button className="project-toggle" aria-label={`${project.collapsed ? '展开' : '收起'}项目 ${project.name}`} aria-expanded={!project.collapsed} aria-controls={`project-${project.id}`} disabled={!connected || pending} onClick={() => void perform(async () => { await request({type:'project.collapse',projectId:project.id,collapsed:!project.collapsed}); })}><WorkspaceIcon name="folder"/><span title={project.name}>{project.name}</span><span aria-hidden="true">{project.collapsed ? '›' : '⌄'}</span></button><button aria-label={`重命名项目 ${project.name}`} title="重命名项目" disabled={!connected || pending} onClick={() => edit(project)}><WorkspaceIcon name="edit"/></button></div>
        <div id={`project-${project.id}`} hidden={project.collapsed} className="project-children">
          <button className="project-directory" title={project.workspace} disabled={!connected || pending} onClick={() => void createSession(project, true)}><WorkspaceIcon name="folder"/><span>项目目录</span></button>
          <button className="project-new-chat" disabled={!connected || pending} onClick={() => void createSession(project)}><WorkspaceIcon name="plus"/>新对话 · {project.name}</button>
          {sessionButtons(sessions.filter(s => s.projectId === project.id))}
        </div>
      </section>)}
      <div className="sidebar-label">独立对话</div>{sessionButtons(sessions.filter(s => !s.projectId))}
      {!sessions.length && !projects.length && <p className="sidebar-empty">新的想法，从这里开始。<br/>连接 Host 后保存你的会话。</p>}
      {!dialog && error && <p role="alert" className="error">{error}</p>}
    </nav>
    {dialog && createPortal(<div className="modal-backdrop project-dialog" onClick={close}><section ref={modal} className="modal" role="dialog" aria-modal="true" aria-label={dialog === 'create' ? '新建项目' : '重命名项目'} onClick={e => e.stopPropagation()}><div className="modal-heading"><h2>{dialog === 'create' ? '新建项目' : '重命名项目'}</h2><button aria-label="关闭项目弹窗" disabled={pending} onClick={close}><WorkspaceIcon name="close"/></button></div><div className="modal-body"><form onSubmit={e => { e.preventDefault(); void perform(async () => {
      if (dialog === 'create') await request({type:'project.create',path,name:name.trim() || undefined,confirmed:true});
      else await request({type:'project.rename',projectId:dialog.id,name});
      generation.current++; setDialog(undefined);
    }); }}>
      <label>项目名称<input aria-label="项目名称" maxLength={100} required={dialog !== 'create'} disabled={pending} value={name} onChange={e => setName(e.target.value)} placeholder="默认使用文件夹名称"/></label>
      {dialog === 'create' && <><label>项目文件夹<input aria-label="项目文件夹" required readOnly={!!chooseDirectory} disabled={pending} value={path} onChange={e => setPath(e.target.value)} placeholder={chooseDirectory ? '请选择本地文件夹' : '输入本机 Host 上的绝对路径'}/></label>{chooseDirectory ? <button type="button" disabled={pending} onClick={() => { const revision = generation.current; void perform(async () => { const directory = await chooseDirectory(); if (directory && generation.current === revision) { setPath(directory); setName(value => value || directory.split(/[\\/]/).filter(Boolean).at(-1)!.slice(0,100)); } }); }}>选择文件夹…</button> : <p className="settings-note">Web 无系统目录选择器。仅授权当前连接的本机 Host 可访问的路径，托管预览无法访问你的电脑。</p>}<p className="settings-note">确认后，项目下新建的对话可读取此目录，文件写入仍逐次审批。授权随项目保存在本机；目录移动或替换后需恢复原目录或新建项目。</p></>}
      {error && <p role="alert" className="error">{error}</p>}<div className="modal-actions"><button type="button" disabled={pending} onClick={close}>取消</button><button className="primary" disabled={!connected || pending || (dialog === 'create' ? !path.trim() : !name.trim())}>{pending ? '处理中…' : dialog === 'create' ? '创建并授权项目' : '保存名称'}</button></div>
    </form></div></section></div>, document.body)}
  </>;
}
