import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CredentialVault } from '../../host/src/credentials.js';
export interface SystemCrypto { isEncryptionAvailable(): boolean; getSelectedStorageBackend(): string; encryptString(value: string): Buffer; decryptString(value: Buffer): string }
/** Electron 45 safeStorage. Reject Linux basic_text/unknown: never plaintext fallback. */
export function credentialVault(directory: string, crypto: SystemCrypto, platform = process.platform): CredentialVault {
  const file = join(directory, 'credentials', 'deepseek.enc');
  const available = () => crypto.isEncryptionAvailable() && (platform !== 'linux' || ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(crypto.getSelectedStorageBackend()));
  const requireSecure = () => { if (!available()) throw new Error('系统安全存储不可用；可明确选择仅本次会话保存'); };
  return {
    async available() { return available(); },
    async load() { let encrypted: Buffer; try { encrypted = await readFile(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw new Error('无法读取本地凭据'); } requireSecure(); try { return crypto.decryptString(encrypted); } catch { throw new Error('系统安全存储无法解密凭据，请重新保存或删除'); } },
    async save(key) { requireSecure(); let encrypted: Buffer; try { encrypted = crypto.encryptString(key); } catch { throw new Error('系统安全存储加密失败'); } await mkdir(join(directory, 'credentials'), { recursive: true, mode: 0o700 }); const temporary = `${file}.${randomUUID()}.tmp`; try { await writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 }); await rename(temporary, file); } finally { await rm(temporary, { force: true }); } },
    async delete() { await rm(file, { force: true }); },
  };
}
