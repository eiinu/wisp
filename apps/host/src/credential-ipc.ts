import { randomUUID } from 'node:crypto';
import type { CredentialVault } from './credentials.js';
/** Private parent/Host channel, never a Renderer request or notice. */
export function parentCredentialVault(): CredentialVault {
  const call = <T>(operation: string, key?: string) => new Promise<T>((resolve, reject) => {
    const id = randomUUID(); const timer = setTimeout(() => { process.off('message', listener); reject(new Error('系统凭据存储响应超时')); }, 12000);
    const listener = (value: any) => { if (value?.type !== 'credential-response' || value.id !== id) return; clearTimeout(timer); process.off('message', listener); value.ok ? resolve(value.value as T) : reject(new Error('系统凭据存储失败；请检查系统钥匙串或删除后重新保存')); };
    process.on('message', listener); process.send?.({ type: 'credential-request', id, operation, ...(key !== undefined ? { key } : {}) });
  });
  return { available: () => call<boolean>('available'), load: () => call<string | undefined>('load'), save: key => call<void>('save', key), delete: () => call<void>('delete') };
}
