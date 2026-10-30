import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Message } from '@wisp/core';
/** Host-only, mode 0600 conversation state; never included in snapshots or diagnostic JSONL. */
export class ConversationStore {
  constructor(private directory: string, private sessionId: string) {}
  private get file() { return join(this.directory, 'private-conversations', `${this.sessionId}.json`); }
  async read(): Promise<Message[] | undefined> {
    let text: string;
    try { text = await readFile(this.file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    const value = JSON.parse(text);
    if (value.version !== 1 || !Array.isArray(value.messages) || !value.messages.every((m: Message) => ['user', 'assistant', 'tool'].includes(m.role) && typeof m.text === 'string')) throw new Error('Invalid private conversation');
    const messages: Message[] = value.messages;
    // A crash/cancellation never grants permission to replay an unresolved tool call.
    const recovered: Message[] = [];
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i]; recovered.push(message);
      if (!message.calls?.length) continue;
      const results: Message[] = [];
      while (messages[i + 1]?.role === 'tool') results.push(messages[++i]);
      for (const call of message.calls) recovered.push(results.find(m => m.callId === call.id) ?? { role: 'tool', callId: call.id, toolName: call.name, isError: true, text: 'Task interrupted. Execution outcome unknown; do not repeat this action. Ask the user to inspect the result.' });
    }
    return recovered;
  }
  async save(messages: Message[], redact: (value: string) => string) {
    const clean = (value: unknown): unknown => typeof value === 'string' ? redact(value) : Array.isArray(value) ? value.map(clean) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [redact(k), clean(v)])) : value;
    await mkdir(join(this.directory, 'private-conversations'), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, messages: clean(messages) }), { mode: 0o600, flag: 'wx' });
    await rename(temporary, this.file);
  }
}
