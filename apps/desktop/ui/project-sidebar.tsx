import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ProjectInfo, Request, Result, SessionInfo } from '@wisp/core';
import { WorkspaceIcon } from './workspace-icon.js';

export function ProjectSidebar({ projects, sessions, selected, connected, request, select, openDirectory, onDialogChange, chooseDirectory }: {
  projects: ProjectInfo[]; sessions: SessionInfo[]; selected?: string; connected: boolean;
  request(input: Request): Promise<Result>; select(id: string): void; openDirectory(id: string): void;
  onDialogChange(open: boolean): void; chooseDirectory?(): Promise<string | undefined>;
}) {
  const [dialog, setDialog] = useState<'create' | ProjectInfo>(), [name, setName] = useState(''), [path, setPath] = useState('');
  const [archived, showArchived] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const lock = useRef(false), generation = useRef(0), modal = useRef<HTMLElement>(null);
  const archiveEntry = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (dialog || pending) return;
    const target = returnFocus.current; returnFocus.current = null;
    // Async saves can close the dialog before the trigger is re-enabled.
    // Restore once, after that commit, without taking focus from another control.
    if (target?.isConnected && !target.disabled && document.activeElement === document.body) target.focus();
  }, [dialog, pending]);
  useEffect(() => { onDialogChange(!!dialog); return () => onDialogChange(false); }, [!!dialog, onDialogChange]);
  useEffect(() => {
    if (!dialog) return;
    const focusable = () => Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? []);
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !lock.current) { event.stopImmediatePropagation(); setDialog(undefined); generation.current++; }
      if (event.key === 'Tab') { const items = focusable(), first = items[0], last = items.at(-1); if (event.shiftKey && (document.activeElement === first || !modal.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && (document.activeElement === last || !modal.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); } }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); };
  }, [dialog]);
  async function perform(task: () => Promise<void>) {
    if (lock.current || !connected) return;
    lock.current = true; setPending(true); setError('');
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { lock.current = false; setPending(false); }
  }
  const close = () => { if (!lock.current) { generation.current++; setDialog(undefined); setError(''); } };
  const edit = (trigger: HTMLButtonElement, project?: ProjectInfo) => { returnFocus.current = trigger; generation.current++; setName(project?.name ?? ''); setPath(project?.workspace ?? ''); setError(''); setDialog(project ?? 'create'); };
  async function createSession(project: ProjectInfo, directory = false) {
    await perform(async () => {
      const existing = directory ? sessions.find(s => !s.archivedAt && s.id === selected && s.projectId === project.id) ?? sessions.find(s => !s.archivedAt && s.projectId === project.id) : undefined;
      const id = existing?.id ?? (await request({ type: 'session.create', projectId: project.id, title: '新会话' })).sessionId;
      if (!id) throw new Error('创建会话失败');
      if (directory) openDirectory(id); else select(id);
    });
  }
  const sessionButtons = (items: SessionInfo[]) => items.filter(s => !s.archivedAt).map(session => <div className="session-row" key={session.id}><button aria-current={session.id === selected ? 'page' : undefined} className={`session ${session.id === selected ? 'selected' : ''}`} onClick={() => select(session.id)} disabled={!connected}><span className="session-title" title={session.title}>{session.title}</span>{session.activeRunId && <span className="pulse" title="执行中"/>}</button><button className="session-action" aria-label={`归档对话 ${session.title}`} title={session.activeRunId ? '任务运行或等待审批中，完成后才能归档' : '归档对话（保留历史）'} disabled={!connected || pending || !!session.activeRunId} onClick={() => void perform(async () => { returnFocus.current = archiveEntry.current; await request({type:'session.archive',sessionId:session.id}); })}><WorkspaceIcon name="archive"/></button></div>);
  const archiveList = sessions.filter(s => s.archivedAt);

  return <>
    <nav className="project-navigation" aria-label="项目与会话">
      <button ref={archiveEntry} className="archive-entry" aria-pressed={archived} onClick={() => showArchived(!archived)}><WorkspaceIcon name={archived ? 'back' : 'archive'}/>{archived ? '返回会话' : `归档对话${archiveList.length ? ` (${archiveList.length})` : ''}`}</button>
      {archived ? <section aria-label="归档对话列表"><p className="sidebar-empty">归档保留历史和目录归属。恢复后可在原列表继续。</p>{!archiveList.length && <p className="sidebar-empty">暂无归档对话</p>}{archiveList.map(session => <div className="archived-session" key={session.id}><div><strong title={session.title}>{session.title}</strong><small>{projects.find(p => p.id === session.projectId)?.name ?? '独立对话'}</small></div><button className="session-action" aria-label={`恢复对话 ${session.title}`} title="恢复到原会话列表" disabled={!connected || pending} onClick={() => void perform(async () => { returnFocus.current = archiveEntry.current; await request({type:'session.restore',sessionId:session.id}); })}><WorkspaceIcon name="restore"/></button></div>)}</section> : <>
      <div className="project-section-heading"><span>项目</span><button aria-label="新建项目" title="新建项目" disabled={!connected || pending} onClick={event => edit(event.currentTarget)}><WorkspaceIcon name="plus"/></button></div>
      {projects.map(project => <section className="project-group" key={project.id}>
        <div className="project-row"><button className="project-toggle" aria-label={`${project.collapsed ? '展开' : '收起'}项目 ${project.name}`} aria-expanded={!project.collapsed} aria-controls={`project-${project.id}`} disabled={!connected || pending} onClick={() => void perform(async () => { await request({type:'project.collapse',projectId:project.id,collapsed:!project.collapsed}); })}><WorkspaceIcon name="folder"/><span title={project.name}>{project.name}</span><WorkspaceIcon name="chevron"/></button><button aria-label={`重命名项目 ${project.name}`} title="重命名项目" disabled={!connected || pending} onClick={event => edit(event.currentTarget, project)}><WorkspaceIcon name="edit"/></button></div>
        <div id={`project-${project.id}`} hidden={project.collapsed} className="project-children">
          <button className="project-directory" title={project.workspace} disabled={!connected || pending} onClick={() => void createSession(project, true)}><WorkspaceIcon name="folder"/><span>项目目录</span></button>
          <button className="project-new-chat" title={`在 ${project.name} 中新建对话`} aria-label={`在 ${project.name} 中新建对话`} disabled={!connected || pending} onClick={() => void createSession(project)}><WorkspaceIcon name="plus"/><span>新对话</span></button>
          {sessionButtons(sessions.filter(s => s.projectId === project.id))}
        </div>
      </section>)}
      <div className="sidebar-label">独立对话</div>{sessionButtons(sessions.filter(s => !s.projectId))}
      {!sessions.some(s => !s.archivedAt) && !projects.length && <p className="sidebar-empty">新的想法，从这里开始。<br/>连接 Host 后保存你的会话。</p>}
      </>}
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
