import { randomUUID } from 'node:crypto';
import type { GenerationProvider, ModelReply } from '@wisp/core';
import { setTimeout } from 'node:timers/promises';
// Explicit diagnostic provider; actual tools still execute in the normal Agent loop.
export const offlineProvider: GenerationProvider = {
  async generate(messages, tools, signal, onText) {
    const lastUser = messages.findLastIndex(m => m.role === 'user');
    const current = messages.slice(lastUser), result = current.findLast(m => m.role === 'tool');
    let reply: ModelReply;
    if (result) reply = { text: result.isError ? '操作已拒绝，未执行写入。' : `离线验证完成。以下是 Host 的实际返回：\n\n${result.text}` };
    else {
      const prompt = current[0].text;
      const write = /^写入 ([^\n]+)\n([\s\S]*)$/.exec(prompt), read = /^读取 (.+)$/.exec(prompt);
      const name = write ? 'files_write' : read ? 'files_read' : /列出|文件/.test(prompt) ? 'files_list' : undefined;
      if (name && tools.some(t => t.name === name)) reply = { text: '离线验证模式：将使用本机 Host 的文件工具。', calls: [{ id: randomUUID(), name, args: write ? { path: write[1], content: write[2] } : { path: read?.[1] ?? '' } }] };
      else reply = { text: '当前是离线验证模式，不会调用大模型。授权目录后可以发送“列出文件”、“读取 README.md”或“写入 notes.txt\\n内容”。日常自然语言任务请在模型设置中配置真实提供商。' };
    }
    if (onText) for (const chunk of reply.text.match(/.{1,16}/gs) ?? []) { await setTimeout(12, undefined, { signal }); onText(chunk); }
    return reply;
  },
};
