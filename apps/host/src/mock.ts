import type { GenerationProvider, Tool } from '@wisp/core';
export const mockProvider: GenerationProvider = {
  async generate(messages) {
    const result = messages.findLast(m => m.role === 'tool');
    if (result) return { text: `Mock 完成：${result.text}` };
    return { text: '这是本地 Mock 演示。将请求一个无副作用的回显工具。', calls: [{ id: 'echo-1', name: 'demo.echo', args: { text: messages[0].text } }] };
  },
};
export const echoTool: Tool = {
  name: 'demo.echo', description: '演示工具：只返回输入文字，不读写文件、不访问网络。',
  requiresApproval: true, inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  async execute(args, signal) { signal.throwIfAborted(); if (typeof args.text !== 'string') throw new Error('text must be a string'); return args.text; },
};
