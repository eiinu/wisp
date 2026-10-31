import React from 'react';
import type { RunEvent } from '@wisp/core';
const names: Record<string, string> = { files_list: '浏览目录', files_read: '读取文件', files_write: '写入文件' };
/** Only presentation: preview still uses the current session's Host authorization. */
export function ToolActivity({ events, ended, canPreview, openFile }: { events: RunEvent[]; ended: boolean; canPreview: boolean; openFile(path: string): void }) {
  const calls = events.filter(e => e.type === 'tool_requested');
  if (!calls.length) return null;
  return <div className="tool-activity" aria-label="工具执行过程">{calls.map(call => {
    const id = call.data.id, name = String(call.data.name), args = call.data.args as Record<string, unknown> | undefined;
    const result = events.find(e => e.type === 'tool_result' && e.data.callId === id);
    const started = events.some(e => e.type === 'tool_started' && e.data.callId === id);
    const approval = events.some(e => e.type === 'approval_requested' && e.data.id === id);
    const status = result ? result.data.denied ? '已拒绝' : result.data.isError ? '失败' : '已完成' : ended ? '已中断' : started ? '执行中' : approval ? '等待批准' : '检查参数';
    const path = typeof args?.path === 'string' ? args.path : '';
    return <details key={call.id} className="tool-trace"><summary><strong>{names[name] ?? name}</strong> <span>{path || (name === 'files_list' ? '工作目录' : '')}</span><small>{status}</small></summary>
      <p>{name}</p><pre>{JSON.stringify(args, null, 2)}</pre>
      {result && <pre>{String(result.data.text ?? '')}</pre>}
      {result && !result.data.denied && !result.data.isError && ['files_read', 'files_write'].includes(name) && path && <button disabled={!canPreview} onClick={() => openFile(path)}>预览文件</button>}
    </details>;
  })}</div>;
}
