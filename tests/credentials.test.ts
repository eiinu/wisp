import { it, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { credentialVault, type SystemCrypto } from '../apps/desktop/src/credential-vault.js';
import { Runtime } from '../apps/host/src/runtime.js';
const config = { provider: 'deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com' };
function fakeCrypto(): SystemCrypto {
  // Fake OS service for tests only; production exclusively uses Electron safeStorage.
  const key = randomBytes(32);
  return { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret', encryptString(text) { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv), data = Buffer.concat([c.update(text, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), data]); }, decryptString(data) { const d = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); d.setAuthTag(data.subarray(12, 28)); return Buffer.concat([d.update(data.subarray(28)), d.final()]).toString(); } };
}
it('does not access macOS Keychain for availability or an empty profile, and uses async crypto for real reads/writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wisp-mac-vault-')), crypto = fakeCrypto();
  const encrypt = crypto.encryptString.bind(crypto), decrypt = crypto.decryptString.bind(crypto);
  crypto.isEncryptionAvailable = vi.fn(() => { throw new Error('Synchronous Keychain access must not run'); });
  crypto.encryptString = vi.fn(() => { throw new Error('Synchronous encryption must not run'); });
  crypto.decryptString = vi.fn(() => { throw new Error('Synchronous decryption must not run'); });
  crypto.isAsyncEncryptionAvailable = vi.fn(async () => true);
  crypto.encryptStringAsync = vi.fn(async text => encrypt(text));
  crypto.decryptStringAsync = vi.fn(async bytes => ({result: decrypt(bytes), shouldReEncrypt: false}));
  const vault = credentialVault(root, crypto, 'darwin');
  try {
    const runtime = new Runtime(root, undefined, vault); await runtime.init();
    expect(runtime.snapshot().credential?.storage).toBe('secure');
    expect(crypto.isAsyncEncryptionAvailable).not.toHaveBeenCalled();
    expect(crypto.encryptStringAsync).not.toHaveBeenCalled();
    expect(crypto.decryptStringAsync).not.toHaveBeenCalled();
    await vault.save('fake-mac-secret'); expect(await vault.load()).toBe('fake-mac-secret');
    expect(crypto.encryptStringAsync).toHaveBeenCalledOnce(); expect(crypto.decryptStringAsync).toHaveBeenCalledOnce();
    crypto.isAsyncEncryptionAvailable = vi.fn(async () => false);
    await expect(vault.save('fake-denied')).rejects.toThrow('安全存储');
    expect(crypto.encryptStringAsync).toHaveBeenCalledOnce();
    expect(crypto.isEncryptionAvailable).not.toHaveBeenCalled(); expect(crypto.encryptString).not.toHaveBeenCalled(); expect(crypto.decryptString).not.toHaveBeenCalled();
    await runtime.shutdown();
  } finally {await rm(root, {recursive:true, force:true});}
});
it('saves/restarts/replaces/deletes fake credentials without exposing them in metadata or renderer snapshots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wisp-vault-')), crypto = fakeCrypto(), vault = credentialVault(root, crypto, 'linux');
  try {
    let runtime = new Runtime(root, undefined, vault); await runtime.init();
    await runtime.request({ type: 'model.save', config, apiKey: 'fake-secret-one', rememberKey: true });
    expect(JSON.stringify(runtime.snapshot())).not.toContain('fake-secret-one'); expect(runtime.snapshot().credential).toMatchObject({ saved: true, storage: 'secure' });
    expect((await readFile(join(root, 'credentials/deepseek.enc'))).includes(Buffer.from('fake-secret-one'))).toBe(false);
    expect(await readFile(join(root, 'state.json'), 'utf8')).not.toContain('fake-secret');
    await runtime.shutdown(); runtime = new Runtime(root, undefined, credentialVault(root, crypto, 'linux')); await runtime.init(); expect(runtime.snapshot().keyPresent).toBe(true);
    await runtime.request({ type: 'model.save', config, apiKey: 'fake-secret-two', rememberKey: true }); expect(await vault.load()).toBe('fake-secret-two');
    await runtime.request({ type: 'model.save', config: { ...config, baseUrl: 'http://127.0.0.1:9999' } }); expect(runtime.snapshot().keyPresent).toBe(false);
    await runtime.request({ type: 'model.save', config }); expect(runtime.snapshot().keyPresent).toBe(true);
    await expect(runtime.request({ type: 'model.save', config: { ...config, baseUrl: 'https://third-party.invalid' }, rememberKey: true })).rejects.toThrow('官方');
    await runtime.request({ type: 'model.clearKey' }); expect(await vault.load()).toBeUndefined(); expect(runtime.snapshot().keyPresent).toBe(false);
    await runtime.shutdown(); const after = new Runtime(root, undefined, vault); await after.init(); expect(after.snapshot().keyPresent).toBe(false); await after.shutdown();
  } finally { await rm(root, { recursive: true, force: true }); }
});
it.each(['basic_text', 'unknown'])('rejects insecure Linux backend %s without plaintext downgrade', async backend => {
  const root = await mkdtemp(join(tmpdir(), 'wisp-vault-fail-')), crypto = fakeCrypto(); crypto.getSelectedStorageBackend = () => backend; const encrypt = vi.spyOn(crypto, 'encryptString');
  try { const vault = credentialVault(root, crypto, 'linux'); expect(await vault.available()).toBe(false); await expect(vault.save('fake')).rejects.toThrow('安全存储'); expect(encrypt).not.toHaveBeenCalled(); } finally { await rm(root, { recursive: true, force: true }); }
});
it('handles encrypt/decrypt failures, permits deletion, and Web requires explicit session storage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wisp-vault-errors-')), crypto = fakeCrypto(), vault = credentialVault(root, crypto, 'linux');
  try {
    await vault.save('fake'); crypto.decryptString = () => { throw new Error('fake secret in OS error'); };
    const runtime = new Runtime(root, undefined, vault); await runtime.init(); expect(runtime.snapshot().keyPresent).toBe(false); expect(runtime.snapshot().credential?.error).toBeTruthy(); expect(JSON.stringify(runtime.snapshot())).not.toContain('fake secret');
    crypto.encryptString = () => { throw new Error('private input'); }; await expect(runtime.request({ type: 'model.save', config, apiKey: 'fake', rememberKey: true })).rejects.toThrow('加密失败');
    await runtime.request({ type: 'model.clearKey' }); expect(await vault.load()).toBeUndefined();
    const web = new Runtime(join(root, 'web')); await web.init(); await expect(web.request({ type: 'model.save', config, apiKey: 'fake', rememberKey: true })).rejects.toThrow('安全持久化');
    await web.request({ type: 'model.save', config, apiKey: 'fake', rememberKey: false }); expect(web.snapshot().keyPresent).toBe(true); await web.shutdown(); await runtime.shutdown();
  } finally { await rm(root, { recursive: true, force: true }); }
});
it('restores through the compiled Host private IPC broker without returning a Key to renderer requests', async () => {
  const { fork } = await import('node:child_process'); const { resolve } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'wisp-vault-ipc-'));
  await writeState();
  async function writeState() { const { writeFile } = await import('node:fs/promises'); await writeFile(join(root, 'state.json'), JSON.stringify({ version: 1, sessions: [], config })); }
  const child = fork(resolve('apps/host/dist/main.js'), [root, '--secure-credentials'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  let saved: string | undefined = 'fake-ipc-secret';
  try {
    await new Promise<void>((resolveReady, reject) => {
      child.once('error', reject); child.on('message', (message: any) => {
        if (message.type === 'host-ready') resolveReady();
        if (message.type !== 'credential-request') return;
        let value: unknown;
        if (message.operation === 'available') value = true;
        if (message.operation === 'load') value = saved;
        if (message.operation === 'save') saved = message.key;
        if (message.operation === 'delete') saved = undefined;
        child.send({ type: 'credential-response', id: message.id, ok: true, value });
      });
    });
    const call = (request: object) => new Promise<any>(resolveCall => { const id = Math.random().toString(); const listener = (message: any) => { if (message.type === 'response' && message.id === id) { child.off('message', listener); resolveCall(message); } }; child.on('message', listener); child.send({ id, request }); });
    const result = await call({ type: 'snapshot' }); expect(result.result.snapshot.keyPresent).toBe(true); expect(JSON.stringify(result)).not.toContain('fake-ipc-secret');
    await call({ type: 'model.clearKey' }); expect(saved).toBeUndefined(); expect((await call({ type: 'snapshot' })).result.snapshot.keyPresent).toBe(false);
  } finally { child.kill(); await new Promise<void>(resolveExit => child.once('exit', () => resolveExit())); await rm(root, { recursive: true, force: true }); }
});
it('isolates MCP secure env by service and never loads it through renderer metadata',async()=>{
 const {mcpEnvironmentOperation}=await import('../apps/desktop/src/mcp-environment.js');const {randomUUID}=await import('node:crypto');
 const root=await mkdtemp(join(tmpdir(),'wisp-mcp-vault-')),crypto=fakeCrypto(),id=randomUUID(),other=randomUUID(),signal=new AbortController().signal,binding='a'.repeat(64);
 try{
  await mcpEnvironmentOperation('mcp.env.save',{id,env:{TOKEN:'fake-mcp-secret'},binding},root,crypto,signal);
  const file=join(root,'mcp-secrets',id,'credentials','deepseek.enc');expect((await readFile(file)).includes(Buffer.from('fake-mcp-secret'))).toBe(false);
  expect(await mcpEnvironmentOperation('mcp.env.load',{id},root,crypto,signal)).toEqual({env:{TOKEN:'fake-mcp-secret'},binding});
  await expect(mcpEnvironmentOperation('mcp.env.load',{id:other},root,crypto,signal)).rejects.toThrow('未保存');
  await expect(mcpEnvironmentOperation('mcp.env.load',{id:'../../escape'},root,crypto,signal)).rejects.toThrow('ID');
  await mcpEnvironmentOperation('mcp.env.delete',{id},root,crypto,signal);await expect(readFile(file)).rejects.toThrow();
  crypto.isEncryptionAvailable=()=>false;await expect(mcpEnvironmentOperation('mcp.env.save',{id,env:{TOKEN:'fake-never-plain'},binding},root,crypto,signal)).rejects.toThrow('安全存储');await expect(readFile(file)).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
});
