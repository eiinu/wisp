import { z } from 'zod';
export const eventSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), runId: z.string().uuid(), sessionId: z.string().uuid().optional(), at: z.string(),
  type: z.enum(['started','assistant_delta','assistant','tool_requested','tool_started','approval_requested','approval_resolved','tool_result','completed','cancelled','failed','model_usage','model_finish','model_error','model_activity']),
  data: z.record(z.string(), z.unknown()),
});
export type RunEvent = z.infer<typeof eventSchema>;
export type Message = { role: 'user' | 'assistant' | 'tool'; text: string; callId?: string; toolName?: string; isError?: boolean; calls?: ToolCall[]; continuation?: PrivateContinuation };
export type ModelReply = { text: string; calls?: { id: string; name: string; args: Record<string, unknown> }[] };
export interface GenerationProvider { generate(messages: Message[], tools: ToolSpec[], signal: AbortSignal, onText?: (text: string) => void): Promise<ModelReply> }
export interface ToolSpec { name: string; description: string; inputSchema: Record<string, unknown> }
export interface Tool extends ToolSpec { requiresApproval: boolean; validate?(args: Record<string, unknown>): void | Promise<void>; execute(args: Record<string, unknown>, signal: AbortSignal): Promise<string> }
export class Registry<T> {
  private entries = new Map<string, T>();
  register(name: string, item: T) { if (this.entries.has(name)) throw new Error(`Duplicate registration: ${name}`); this.entries.set(name, item); }
  get(name: string) { const item = this.entries.get(name); if (!item) throw new Error(`Unknown registration: ${name}`); return item; }
  values() { return [...this.entries.values()]; }
}

export const modelConfigSchema = z.object({
  provider: z.enum(['deepseek', 'openai-compatible', 'offline']),
  model: z.string().trim().min(1).max(160),
  baseUrl: z.string().max(2000),
  thinking: z.enum(['enabled', 'disabled']).optional(),
  effort: z.enum(['low', 'high', 'max']).optional(),
});
export type ModelConfig = z.infer<typeof modelConfigSchema>;
const sid = z.string().uuid();
export const requestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot') }),
  z.object({ type: z.literal('preview.claim'), sessionId: sid, ticket: sid }).strict(),
  z.object({ type: z.literal('preview.complete'), sessionId: sid, ticket: sid, accepted: z.boolean() }).strict(),
  z.object({ type: z.literal('browser.connect'), sessionId: sid, confirmed: z.literal(true) }),
  z.object({ type: z.literal('browser.disconnect'), sessionId: sid }),
  z.object({ type: z.literal('session.create'), title: z.string().trim().min(1).max(100).default('新会话'), projectId: sid.optional() }).strict(),
  z.object({ type: z.literal('project.create'), name: z.string().trim().min(1).max(100).optional(), path: z.string().min(1).max(4096), confirmed: z.literal(true) }).strict(),
  z.object({ type: z.literal('project.rename'), projectId: sid, name: z.string().trim().min(1).max(100) }).strict(),
  z.object({ type: z.literal('project.collapse'), projectId: sid, collapsed: z.boolean() }).strict(),
  z.object({ type: z.literal('session.archive'), sessionId: sid }).strict(),
  z.object({ type: z.literal('session.restore'), sessionId: sid }).strict(),
  z.object({ type: z.literal('session.rename'), sessionId: sid, title: z.string().trim().min(1).max(100) }),
  z.object({ type: z.literal('session.select'), sessionId: sid }),
  z.object({ type: z.literal('run.start'), sessionId: sid, prompt: z.string().trim().min(1).max(16000), maxSteps: z.number().int().min(1).max(20).default(8) }),
  z.object({ type: z.literal('run.retry'), sessionId: sid }),
  z.object({ type: z.literal('run.cancel'), sessionId: sid, runId: sid }),
  z.object({ type: z.literal('run.approve'), sessionId: sid, runId: sid, callId: z.string().min(1), allowed: z.boolean() }),
  z.object({ type: z.literal('workspace.grant'), sessionId: sid, path: z.string().min(1).max(4096), confirmed: z.literal(true) }),
  z.object({ type: z.literal('workspace.revoke'), sessionId: sid }),
  z.object({ type: z.literal('files.list'), sessionId: sid, path: z.string().max(4096).default('') }),
  z.object({ type: z.literal('files.read'), sessionId: sid, path: z.string().min(1).max(4096) }),
  z.object({ type: z.literal('files.write'), sessionId: sid, path: z.string().min(1).max(4096), content: z.string().max(200000) }),
  z.object({ type: z.literal('model.save'), config: modelConfigSchema, apiKey: z.string().max(4096).optional(), rememberKey: z.boolean().optional() }),
  z.object({ type: z.literal('model.clearKey') }),
  z.object({ type: z.literal('model.list') }),
]);
export type Request = z.infer<typeof requestSchema>;
export interface ProjectInfo { id: string; name: string; workspace: string; collapsed: boolean; createdAt: string }
export interface SessionInfo { archivedAt?: string; projectId?: string; id: string; title: string; createdAt: string; updatedAt: string; workspace?: string; activeRunId?: string }
export interface BrowserStatus { state: 'disabled' | 'connecting' | 'connected' | 'failed'; toolCount: number; message?: string }
export interface Snapshot { projects?: ProjectInfo[]; sessions: SessionInfo[]; selectedId?: string; config?: ModelConfig; keyPresent: boolean; credential?: { storage: 'secure' | 'session'; saved: boolean; error?: string }; events: RunEvent[]; browserConnected: boolean; browserSessions?: Record<string, BrowserStatus> }
export interface FileEntry { name: string; path: string; kind: 'directory' | 'file'; size: number }
export interface FilePreview { path: string; kind: 'text' | 'markdown' | 'image' | 'unsupported'; text?: string; dataUrl?: string; size: number }
export interface Result { preview?: { ticket: string; url: string }; projectId?: string; models?: ModelInfo[]; snapshot?: Snapshot; sessionId?: string; entries?: FileEntry[]; file?: FilePreview }
export type PreviewNotice = { type: 'preview.open'; sessionId: string; ticket: string };
export type Notice = PreviewNotice | { type: 'event'; event: RunEvent } | { type: 'changed' } | { type: 'disconnected'; message: string };
export interface WorkbenchBridge { request(request: Request): Promise<Result>; subscribe(listener: (notice: Notice) => void): () => void }

// Provider-neutral contract. Private continuation never belongs in RunEvent or Renderer state.
export interface ToolCall { id: string; name: string; args: Record<string, unknown> }
export interface PrivateContinuation { provider: string; protocol: string; model: string; endpoint: string; reasoning: string }
export interface ModelInfo { id: string; name?: string; contextWindow?: number; maxOutputTokens?: number; inputModalities?: string[]; outputModalities?: string[]; effort?: { supportedLevels: string[]; defaultLevel?: string } }
export interface ModelUsage { input: number; output: number; total: number; cacheHit?: number; cacheMiss?: number; reasoning?: number }
export interface ModelRequest { messages: Message[]; tools: ToolSpec[]; toolChoice?: 'auto' | 'none' | 'required' | { name: string }; responseFormat?: 'text' | 'json_object' }
export type ModelEvent =
 | { type: 'text_delta' | 'reasoning_delta'; delta: string }
 | { type: 'tool_delta'; index: number; id?: string; name?: string; arguments?: string }
 | { type: 'usage'; usage: ModelUsage }
 | { type: 'finish'; reason: string; message: Message }
 | { type: 'error'; code: string; providerCode?: string | number; status?: number; retryable: boolean; partial: boolean };
export interface ModelProvider {
 listModels(options: { signal: AbortSignal }): Promise<ModelInfo[]>;
 stream(request: ModelRequest, options: { signal: AbortSignal }): AsyncIterable<ModelEvent>;
}

export const projectsSchema = z.array(z.object({ id: z.string().uuid(), name: z.string().min(1).max(100), workspace: z.string().min(1), collapsed: z.boolean(), createdAt: z.string(), identity: z.object({ dev: z.string(), ino: z.string() }) }));
export type StoredProject = z.infer<typeof projectsSchema>[number];
