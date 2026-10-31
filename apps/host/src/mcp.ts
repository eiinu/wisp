import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Registry, type Tool } from '@wisp/core';
export interface McpToolPolicy {
  allowedNames?: ReadonlySet<string>;
  omitParameters?: readonly string[];
  validate?: (name: string, args: Record<string, unknown>) => void;
}
// Only registers already connected clients. Process lifecycle belongs to the caller.
export async function registerMcpTools(client: Client, namespace: string, registry: Registry<Tool>, policy: McpToolPolicy = {}) {
  let cursor: string | undefined;
  const cursors = new Set<string>();
  do {
    const page = await client.listTools({ cursor }, { timeout: 4000 });
    for (const spec of page.tools) {
      if (policy.allowedNames && !policy.allowedNames.has(spec.name)) continue;
      const name = `${namespace}_${spec.name}`;
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new Error('MCP tool name is not compatible with model APIs');
      const inputSchema = structuredClone(spec.inputSchema);
      for (const omitted of policy.omitParameters ?? []) {
        if (inputSchema.properties) delete inputSchema.properties[omitted];
        if (inputSchema.required) inputSchema.required = inputSchema.required.filter(key => key !== omitted);
      }
      registry.register(name, {
        name, description: spec.description ?? spec.name, inputSchema,
        requiresApproval: true,
        validate(args) {
          for (const omitted of policy.omitParameters ?? []) if (Object.hasOwn(args, omitted)) throw new Error(`Unsupported MCP argument: ${omitted}`);
          policy.validate?.(spec.name, args);
        },
        async execute(args, signal) {
          signal.throwIfAborted();
          const approved = structuredClone(args);
          for (const omitted of policy.omitParameters ?? []) if (Object.hasOwn(approved, omitted)) throw new Error(`Unsupported MCP argument: ${omitted}`);
          policy.validate?.(spec.name, approved);
          const result = await client.callTool({ name: spec.name, arguments: approved }, undefined, { signal, timeout: 15000 });
          signal.throwIfAborted();
          if (result.isError) throw new Error(`MCP tool failed: ${name}`);
          return JSON.stringify(result.content).slice(0, 32000);
        },
      });
    }
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw new Error('MCP pagination repeated a cursor');
    if (cursor) cursors.add(cursor);
  } while (cursor);
}
