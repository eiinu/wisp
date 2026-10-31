import type { Tool, ToolSpec } from '@wisp/core';

/** Capture definitions once per run, before any provider or event consumer can mutate them. */
export function snapshotTools(input: Tool[]) {
  const validate = (args: Record<string, unknown>) => {
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) {
      throw new Error('tool_introspect 仅接受空对象 {}');
    }
  };
  let json: string;
  const introspect: Tool = {
    name: 'tool_introspect',
    description: '列出本次任务开始时实际提供给模型的工具定义及审批要求（包含本工具）。仅返回元数据，不读取文件、网页、凭据或环境变量。新激活的工具在下一次任务生效。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    requiresApproval: false,
    validate,
    execute: async (args, signal) => { validate(args); signal.throwIfAborted(); return json; },
  };
  if (input.some(tool => tool.name === introspect.name)) throw new Error('Reserved tool name: tool_introspect');
  const tools = [...input, introspect].map(tool => ({ ...tool, inputSchema: structuredClone(tool.inputSchema) }));
  const metadata = structuredClone(tools.map(({ name, description, inputSchema, requiresApproval }) => ({ name, description, inputSchema, requiresApproval })));
  json = JSON.stringify(metadata);
  const definitions: ToolSpec[] = metadata.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  // Every provider invocation receives its own copy; mutations cannot change the run snapshot.
  return { tools, definitions: () => structuredClone(definitions) };
}
