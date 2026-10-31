import { randomUUID } from 'node:crypto';
import { Registry, type ModelProvider, type GenerationProvider, type Message, type RunEvent, type Tool } from '@wisp/core';
import { asModelProvider } from './model.js';
import { EventLog } from './log.js';
export class Agent {
  private active?: { id: string; controller: AbortController };
  private pending?: { runId: string; callId: string; resolve: (value: boolean) => void };
  constructor(private model: ModelProvider | GenerationProvider, private tools: Registry<Tool>, private log: EventLog, private publish: (event: RunEvent) => void, private sessionId?: string, private redact: (text: string) => string = text => text, private credentialLength = 0, private checkpoint?: (messages: Message[]) => Promise<void>) {}
  private redactData(value: unknown): unknown {
    if (typeof value === 'string') return this.redact(value);
    if (Array.isArray(value)) return value.map(item => this.redactData(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.redactData(item)]));
    return value;
  }
  get activeRunId() { return this.active?.id; }
  approve(runId: string, callId: string, allowed: boolean) {
    if (!this.pending || this.pending.runId !== runId || this.pending.callId !== callId) throw new Error('No matching pending approval');
    const pending = this.pending; this.pending = undefined; pending.resolve(allowed);
  }
  cancel(runId: string) { if (this.active?.id === runId) this.active.controller.abort(); }
  async run(prompt: string, maxSteps = 6, history: Message[] = []) {
    if (this.active) throw new Error('A run is already active');
    if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 20) throw new Error('Invalid step budget');
    const id = randomUUID(), controller = new AbortController(), signal = controller.signal;
    this.active = { id, controller };
    const emit = async (type: RunEvent['type'], data: RunEvent['data'] = {}) => {
      const event: RunEvent = { version: 1, id: randomUUID(), runId: id, sessionId: this.sessionId, at: new Date().toISOString(), type, data: this.redactData(data) as RunEvent['data'] };
      await this.log.append(event); this.publish(event);
    };
    const callIds = new Set<string>();
    const messages: Message[] = [...history, { role: 'user', text: prompt }];
    try {
      await emit('started', { prompt, maxSteps });
      for (let step = 0; step < maxSteps; step++) {
        signal.throwIfAborted();
        let chunks = Promise.resolve();
        let buffered = '';
        const stream = (text: string) => {
          if (signal.aborted) return;
          buffered = this.redact(buffered + text);
          const safeLength = Math.max(0, buffered.length - this.credentialLength);
          const safe = buffered.slice(0, safeLength); buffered = buffered.slice(safeLength);
          if (safe) chunks = chunks.then(() => emit('assistant_delta', { text: safe, step }));
        };
        const generate = async () => {
          let message: Message | undefined, thinking = false;
          for await (const event of asModelProvider(this.model).stream({ messages, tools: this.tools.values().map(({ name, description, inputSchema }) => ({ name, description, inputSchema: structuredClone(inputSchema) })) }, { signal })) {
            signal.throwIfAborted();
            if (event.type === 'reasoning_delta' && !thinking) { thinking = true; await emit('model_activity', { phase: 'thinking', step }); }
            if (event.type === 'text_delta') stream(event.delta);
            if (event.type === 'usage') await emit('model_usage', { ...event.usage, step });
            if (event.type === 'error') { await emit('model_error', { code: event.code, providerCode: event.providerCode, status: event.status, partial: event.partial, retryable: event.retryable, step }); throw new Error(`Model error: ${event.code}`); }
            if (event.type === 'finish') {
              await emit('model_finish', { reason: event.reason, step });
              if (!['stop', 'tool_calls'].includes(event.reason)) throw new Error(`Model finish: ${event.reason}`);
              message = event.message;
            }
          }
          if (!message) throw new Error('Model stream ended without finish');
          return message;
        };
        const reply = await abortable(generate(), signal).finally(() => chunks);
        const calls = structuredClone(reply.calls ?? []);
        await chunks;
        signal.throwIfAborted();
        if (buffered) await emit('assistant_delta', { text: this.redact(buffered), step });
        messages.push(structuredClone(reply)); await this.checkpoint?.(messages);
        if (reply.text) await emit('assistant', { text: reply.text, step });
        if (!calls.length) { await emit('completed'); return; }
        if (calls.length > 8) throw new Error('Too many tool calls in one step');
        // Reject ambiguous batches before any side effect or approval can occur.
        for (const call of calls) {
          if (!call.id || callIds.has(call.id)) throw new Error('Tool call IDs must be unique within a run');
          callIds.add(call.id);
        }
        for (const call of calls) {
          signal.throwIfAborted();

          // No mutable provider-owned object is retained across the approval wait.
          const freeze = (value: unknown): void => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
          freeze(call);
          await emit('tool_requested', { ...call });
          let tool: Tool;
          try {
            tool = this.tools.get(call.name);
            await tool.validate?.(call.args);
            signal.throwIfAborted();
          } catch (error) {
            signal.throwIfAborted();
            const text = JSON.stringify({ error: 'invalid_tool_request', message: this.redact(error instanceof Error ? error.message : 'Invalid tool request') });
            messages.push({ role: 'tool', text, callId: call.id, toolName: call.name, isError: true });
            await this.checkpoint?.(messages);
            await emit('tool_result', { callId: call.id, name: call.name, text, isError: true });
            continue;
          }
          const execute = tool.execute.bind(tool);
          if (tool.requiresApproval) {
            const decision = new Promise<boolean>(resolve => { this.pending = { runId: id, callId: call.id, resolve }; });
            await emit('approval_requested', { ...call, description: tool.description });
            let allowed: boolean;
            try { allowed = await abortable(decision, signal); } finally { this.pending = undefined; }
            await emit('approval_resolved', { callId: call.id, allowed });
            if (!allowed) {
              messages.push({ role: 'tool', text: 'User denied this action. Do not retry.', callId: call.id, toolName: call.name, isError: true });
              await this.checkpoint?.(messages);
              await emit('tool_result', { callId: call.id, text: 'Denied by user', denied: true });
              continue;
            }
          }
          signal.throwIfAborted();
          await emit('tool_started', { callId: call.id, name: call.name });
          let text: string, isError = false;
          try { text = await abortable(execute(call.args, signal), signal); signal.throwIfAborted(); }
          catch (error) {
            signal.throwIfAborted(); isError = true;
            text = JSON.stringify({ error: 'tool_execution_failed', message: this.redact(error instanceof Error ? error.message : 'Tool execution failed') });
          }
          messages.push({ role: 'tool', text, callId: call.id, toolName: call.name, isError });
          await this.checkpoint?.(messages);
          await emit('tool_result', { callId: call.id, name: call.name, text, isError });
        }
      }
      await emit('failed', { reason: 'Step budget exhausted' });
    } catch (e) {
      await emit(signal.aborted ? 'cancelled' : 'failed', { reason: signal.aborted ? 'Cancelled by user' : e instanceof Error ? e.message : 'Unknown failure' });
    } finally { try { await this.checkpoint?.(messages); } finally { this.pending = undefined; this.active = undefined; } }
  }
}
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('Cancelled'));
    if (signal.aborted) { promise.catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
