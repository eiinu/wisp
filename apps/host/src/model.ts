import type { GenerationProvider, ModelEvent, ModelInfo, ModelProvider, ModelRequest } from '@wisp/core';
/** Migration boundary for deterministic providers and pi-ai; Agent has one stream consumer. */
export function streamingProvider(provider: GenerationProvider, models: ModelInfo[] = []): ModelProvider {
  return {
    async listModels({ signal }) { signal.throwIfAborted(); return structuredClone(models); },
    async *stream(request: ModelRequest, { signal }): AsyncIterable<ModelEvent> {
      if (request.toolChoice || request.responseFormat) { yield { type: 'error', code: 'unsupported_parameter', retryable: false, partial: false }; return; }
      const queue: ModelEvent[] = []; let wake: (() => void) | undefined, done = false, failure: unknown;
      const pending = provider.generate(request.messages, request.tools, signal, delta => { queue.push({ type: 'text_delta', delta }); wake?.(); })
        .then(reply => { queue.push({ type: 'finish', reason: reply.calls?.length ? 'tool_calls' : 'stop', message: { role: 'assistant', text: reply.text, calls: reply.calls } }); }, error => { failure = error; })
        .finally(() => { done = true; wake?.(); });
      while (!done || queue.length) { if (queue.length) yield queue.shift()!; else await new Promise<void>(resolve => { wake = resolve; }); }
      await pending; if (failure) throw failure;
    },
  };
}
export function asModelProvider(provider: ModelProvider | GenerationProvider): ModelProvider { return 'stream' in provider ? provider : streamingProvider(provider); }
