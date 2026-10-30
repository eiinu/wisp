import { it, expect, vi } from 'vitest';
import { Registry, type Tool } from '../packages/core/src/index.js';
import { registerMcpTools } from '../apps/host/src/mcp.js';
type Client = Parameters<typeof registerMcpTools>[0];
it('MCP registration always requires approval and propagates cancellation', async () => {
  const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
  const client = { listTools: vi.fn(async () => ({ tools: [{ name: 'read', inputSchema: { type: 'object' } }] })), callTool } as unknown as Client;
  const registry = new Registry<Tool>(); await registerMcpTools(client, 'browser', registry);
  const tool = registry.get('browser_read'); expect(tool.requiresApproval).toBe(true);
  const controller = new AbortController(); await tool.execute({}, controller.signal);
  expect(callTool).toHaveBeenCalledWith({ name: 'read', arguments: {} }, undefined, { signal: controller.signal, timeout: 15000 });
  controller.abort(); await expect(tool.execute({}, controller.signal)).rejects.toThrow(); expect(callTool).toHaveBeenCalledTimes(1);
});
