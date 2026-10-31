import React from 'react';
import { Markdown } from './markdown.js';
import { groupExecution } from './tool-groups.js';
import type { RunEvent } from '@wisp/core';
const names: Record<string, string> = { files_list: '浏览目录', files_read: '读取文件', files_write: '写入文件' };
/** Only presentation: preview still uses the current session's Host authorization. */
export function ToolActivity({ events, ended, canPreview, previewUnavailableReason, openFile }: { events: RunEvent[]; ended: boolean; canPreview: boolean; previewUnavailableReason?: string; openFile(path: string): void }) {
  const {process} = groupExecution(events);
  const calls = process.flatMap(round=>round.events.filter(e=>e.type==='tool_requested'));
  const problems = events.filter(e=>e.type==='tool_result'&&(e.data.isError||e.data.denied));
  if (!calls.length) return null;
  return <div className="tool-activity" aria-label="工具执行过程">
    {problems.length > 0 && <p className="tool-problems" role="status">{problems.filter(e=>e.data.isError).length} 项失败 · {problems.filter(e=>e.data.denied).length} 项已拒绝。展开执行过程查看原因。</p>}
    <details className="execution-process" open={!ended || problems.length > 0}><summary>{ended ? '执行过程' : '正在处理'} · {process.length} 组 · {calls.length} 次工具调用</summary>
    {process.map((round)=><section className="execution-round" key={round.step ?? 'history'} aria-label={round.step === undefined ? '历史工具过程' : `第 ${round.step+1} 轮`}>
    <h4>{round.step === undefined ? '历史工具过程（未记录轮次）' : `第 ${round.step+1} 轮`}</h4>
    {round.text && <Markdown text={round.text}/>}
    {round.events.filter(e=>e.type==='tool_requested').map(call => {
    const id = call.data.id, name = String(call.data.name), args = call.data.args as Record<string, unknown> | undefined;
    const result = round.events.find(e => e.type === 'tool_result' && e.data.callId === id);
    const started = round.events.some(e => e.type === 'tool_started' && e.data.callId === id);
    const approval = round.events.some(e => e.type === 'approval_requested' && e.data.id === id);
    const status = result ? result.data.denied ? '已拒绝' : result.data.isError ? '失败' : '已完成' : ended ? '已中断' : started ? '执行中' : approval ? '等待批准' : '检查参数';
    const path = typeof args?.path === 'string' ? args.path : '';
    return <details key={call.id} className="tool-trace"><summary><strong>{names[name] ?? name}</strong> <span>{path || (name === 'files_list' ? '工作目录' : '')}</span><small>{status}</small></summary>
      <p>{name}</p><strong>调用参数</strong><pre>{JSON.stringify(args, null, 2)}</pre>
      {approval && <p>审批：{result?.data.denied ? '已拒绝' : round.events.some(e=>e.type==='approval_resolved'&&e.data.callId===id&&e.data.allowed) ? '已批准本次调用' : ended ? '已结束，不能继续批准' : '请在下方审批区确认'}</p>}
      {result && <><strong>{result.data.isError ? '错误' : '工具结果'}</strong><pre>{String(result.data.text ?? '')}</pre></>}
      {result && !result.data.denied && !result.data.isError && ['files_read', 'files_write'].includes(name) && path && <span><button disabled={!canPreview} title={!canPreview ? previewUnavailableReason ?? '请先连接本机服务并授权此会话的工作目录' : undefined} onClick={() => openFile(path)}>预览文件</button>{!canPreview && <small className="file-status">{previewUnavailableReason ?? '请先连接本机服务并授权此会话的工作目录'}</small>}</span>}
    </details>;
  })}</section>)}
    </details></div>;
}
