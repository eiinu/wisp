import type { WorkbenchBridge, Notice } from '@wisp/core';
export function webBridge(token: string): WorkbenchBridge {
  if (!/^https?:$/.test(location.protocol)) throw new Error('请通过 HTTP 打开工作台');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  return {
    async request(request) {
      const response = await fetch('/api/request', { method: 'POST', headers, body: JSON.stringify(request), cache: 'no-store', credentials: 'omit', redirect: 'error' });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('此页面没有连接 Wisp Host。请打开 pnpm web 终端给出的本机链接。');
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Host 请求失败'); return body;
    },
    subscribe(listener) {
      const controller = new AbortController();
      void (async () => {
        try {
          const response = await fetch('/api/events', { method: 'POST', headers, signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
          if (!response.ok || !response.body) throw new Error('Host 事件连接失败，请重新连接');
          const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
          while (true) {
            const { value, done } = await reader.read(); if (done) throw new Error('Host 连接已断开');
            buffer += decoder.decode(value, { stream: true });
            let index: number; while ((index = buffer.indexOf('\n\n')) !== -1) {
              const block = buffer.slice(0, index); buffer = buffer.slice(index + 2);
              if (block.startsWith('data: ')) listener(JSON.parse(block.slice(6)) as Notice);
            }
          }
        } catch (error) { if (!controller.signal.aborted) listener({ type: 'disconnected', message: String(error) }); }
      })();
      return () => controller.abort();
    },
  };
}
