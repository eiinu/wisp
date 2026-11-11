import { secureCredentialProvider } from '../packages/core/src/index.js';
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
  const crypto: SystemCrypto = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret', encryptString(text) { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv), data = Buffer.concat([c.update(text, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), data]); }, decryptString(data) { const d = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); d.setAuthTag(data.subarray(12, 28)); return Buffer.concat([d.update(data.subarray(28)), d.final()]).toString(); } };
  // MCP operations select the actual platform: model both safeStorage interfaces.
  crypto.isAsyncEncryptionAvailable = async () => crypto.isEncryptionAvailable();
  crypto.encryptStringAsync = async text => crypto.encryptString(text);
  crypto.decryptStringAsync = async bytes => ({ result: crypto.decryptString(bytes), shouldReEncrypt: false });
  return crypto;
}
it.each(['deepseek','qianfan'] as const)('does not access macOS Keychain for availability or an empty profile, and uses async crypto for %s reads/writes', async provider => {
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
    await vault.save('fake-mac-secret',provider); expect(await vault.load(provider)).toBe('fake-mac-secret');
    expect(crypto.encryptStringAsync).toHaveBeenCalledOnce(); expect(crypto.decryptStringAsync).toHaveBeenCalledOnce();
    crypto.isAsyncEncryptionAvailable = vi.fn(async () => false);
    await expect(vault.save('fake-denied',provider)).rejects.toThrow('安全存储');
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
it.each(['deepseek','qianfan'] as const)('restores %s through the compiled Host private IPC broker without returning a Key to renderer requests', async provider => {
  const { fork } = await import('node:child_process'); const { resolve } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'wisp-vault-ipc-'));
  await writeState();
  async function writeState() { const { writeFile } = await import('node:fs/promises'); await writeFile(join(root, 'state.json'), JSON.stringify({ version: 1, sessions: [], config:provider==='deepseek'?config:{provider:'qianfan',model:'ernie-5.5-flash-preview',baseUrl:'https://qianfan.baidubce.com/v2'} })); }
  const child = fork(resolve('apps/host/dist/main.js'), [root, '--secure-credentials'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  let saved: string | undefined = 'fake-ipc-secret';
  try {
    await new Promise<void>((resolveReady, reject) => {
      child.once('error', reject); child.on('message', (message: any) => {
        if (message.type === 'host-ready') resolveReady();
        if (message.type !== 'credential-request') return;
        if(message.operation!=='available')expect(message.provider).toBe(provider);
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
    await call({type:'model.save',config:provider==='deepseek'?config:{provider:'qianfan',model:'ernie-5.5-flash-preview',baseUrl:'https://qianfan.baidubce.com/v2'},apiKey:'fake-ipc-replacement',rememberKey:true});expect(saved).toBe('fake-ipc-replacement');expect(JSON.stringify(await call({type:'snapshot'}))).not.toContain('fake-ipc-replacement');
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
it('upgrades the legacy DeepSeek slot, isolates Qianfan replacement/deletion and restores both across restarts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wisp-provider-vault-')),crypto=fakeCrypto(),vault=credentialVault(root,crypto,'linux');
 const qianfan={provider:'qianfan',model:'ernie-5.5-flash-preview',baseUrl:'https://qianfan.baidubce.com/v2'};
 try{
  // Existing users already have this exact DeepSeek ciphertext file and model state.
  await vault.save('FAKE_LEGACY_DEEPSEEK');
  let runtime=new Runtime(root,undefined,vault);await runtime.init();
  await runtime.request({type:'model.save',config});expect(runtime.snapshot().keyPresent).toBe(true);
  await runtime.request({type:'model.save',config:qianfan});expect(runtime.snapshot().keyPresent).toBe(false);expect(runtime.snapshot().credential?.saved).toBe(false);
  await runtime.request({type:'model.save',config:qianfan,apiKey:'FAKE_QIANFAN_ONE',rememberKey:true});
  expect(await vault.load('deepseek')).toBe('FAKE_LEGACY_DEEPSEEK');expect(await vault.load('qianfan')).toBe('FAKE_QIANFAN_ONE');
  const ciphertext=await readFile(join(root,'credentials/qianfan.enc'));expect(ciphertext.includes(Buffer.from('FAKE_QIANFAN_ONE'))).toBe(false);
  expect(await readFile(join(root,'state.json'),'utf8')).not.toContain('FAKE_');expect(JSON.stringify(runtime.snapshot())).not.toContain('FAKE_');
  await runtime.shutdown();runtime=new Runtime(root,undefined,vault);await runtime.init();expect(runtime.snapshot()).toMatchObject({keyPresent:true,credential:{saved:true}});
  await runtime.request({type:'model.save',config:qianfan,apiKey:'FAKE_QIANFAN_TWO',rememberKey:true});expect(await vault.load('qianfan')).toBe('FAKE_QIANFAN_TWO');
  await runtime.request({type:'model.save',config:{...qianfan,baseUrl:'https://gateway.invalid/v2'},apiKey:'FAKE_GATEWAY',rememberKey:false});expect(await vault.load('qianfan')).toBe('FAKE_QIANFAN_TWO');
  await runtime.request({type:'model.save',config:qianfan});expect(runtime.snapshot().keyPresent).toBe(true);
  await runtime.request({type:'model.clearKey'});expect(await vault.load('qianfan')).toBeUndefined();expect(await vault.load('deepseek')).toBe('FAKE_LEGACY_DEEPSEEK');
  await runtime.request({type:'model.save',config});expect(runtime.snapshot().keyPresent).toBe(true);
  await runtime.request({type:'model.save',config:qianfan,apiKey:'FAKE_SESSION_ONLY',rememberKey:false});expect(await vault.load('deepseek')).toBe('FAKE_LEGACY_DEEPSEEK');expect(runtime.snapshot().credential?.saved).toBe(false);
  await runtime.shutdown();runtime=new Runtime(root,undefined,vault);await runtime.init();expect(runtime.snapshot().keyPresent).toBe(false);await runtime.shutdown();
 }finally{await rm(root,{recursive:true,force:true});}
});
it('never borrows another provider key when remember is requested without input, and rejects custom scopes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wisp-vault-scope-')),vault=credentialVault(root,fakeCrypto(),'linux'),qianfan={provider:'qianfan',model:'ernie-5.5-flash-preview',baseUrl:'https://qianfan.baidubce.com/v2'};
 try{
  const runtime=new Runtime(root,undefined,vault);await runtime.init();await runtime.request({type:'model.save',config,apiKey:'FAKE_DEEPSEEK',rememberKey:true});
  await expect(runtime.request({type:'model.save',config:qianfan,rememberKey:true})).rejects.toThrow('请输入');expect(runtime.snapshot().config?.provider).toBe('deepseek');expect(await vault.load('qianfan')).toBeUndefined();
  for(const baseUrl of ['https://qianfan.baidubce.com.evil.invalid/v2','https://qianfan.baidubce.com/v2?key=hidden','https://other.invalid/v2'])await expect(runtime.request({type:'model.save',config:{...qianfan,baseUrl},apiKey:'FAKE_NEVER_SAVED',rememberKey:true})).rejects.toThrow();
  expect(await vault.load('deepseek')).toBe('FAKE_DEEPSEEK');expect(await vault.load('qianfan')).toBeUndefined();await runtime.shutdown();
 }finally{await rm(root,{recursive:true,force:true});}
});
it('fails Qianfan encryption/decryption explicitly, keeps other slots and permits deletion without unlocking',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wisp-qianfan-vault-failure-')),crypto=fakeCrypto(),vault=credentialVault(root,crypto,'linux'),qianfan={provider:'qianfan',model:'ernie-5.5-flash-preview',baseUrl:'https://qianfan.baidubce.com/v2'};
 try{
  let runtime=new Runtime(root,undefined,vault);await runtime.init();await runtime.request({type:'model.save',config:qianfan,apiKey:'FAKE_QIANFAN',rememberKey:true});await runtime.shutdown();
  crypto.decryptString=()=>{throw new Error('FAKE_PRIVATE_OS_ERROR');};runtime=new Runtime(root,undefined,vault);await runtime.init();expect(runtime.snapshot().keyPresent).toBe(false);expect(runtime.snapshot().credential?.error).toBeTruthy();expect(JSON.stringify(runtime.snapshot())).not.toContain('FAKE_');
  crypto.getSelectedStorageBackend=()=> 'basic_text';await expect(runtime.request({type:'model.save',config:qianfan,apiKey:'FAKE_NEVER_PLAIN',rememberKey:true})).rejects.toThrow('安全持久化');expect((await readFile(join(root,'credentials/qianfan.enc'))).includes(Buffer.from('FAKE_NEVER_PLAIN'))).toBe(false);
  await runtime.request({type:'model.clearKey'});expect(await vault.load('qianfan')).toBeUndefined();await runtime.shutdown();
 }finally{await rm(root,{recursive:true,force:true});}
});
it.each([
 ['qianfan','https://qianfan.baidubce.com/v2','qianfan'],['qianfan','https://qianfan.baidubce.com/v2/','qianfan'],['deepseek','https://api.deepseek.com/v1','deepseek'],
 ['deepseek','https://qianfan.baidubce.com/v2',undefined],['qianfan','https://api.deepseek.com',undefined],['openai-compatible','https://qianfan.baidubce.com/v2',undefined],
 ['qianfan','https://qianfan.baidubce.com/v2#other',undefined],['qianfan','https://user:password@qianfan.baidubce.com/v2',undefined],['qianfan','http://qianfan.baidubce.com/v2',undefined],['qianfan','https://qianfan.baidubce.com/v1',undefined],
])('binds secure credentials to %s at %s only', (provider,baseUrl,scope)=>{
 expect(secureCredentialProvider({provider:provider!,baseUrl:baseUrl!})).toBe(scope);
});
it('keeps the current provider on a failed switch and reports deletion failure without exposing keys',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wisp-vault-failure-scope-')),vault=credentialVault(root,fakeCrypto(),'linux'),qianfan={provider:'qianfan',model:'ernie-5.5-flash-preview',baseUrl:'https://qianfan.baidubce.com/v2'};
 try{
  const runtime=new Runtime(root,undefined,vault);await runtime.init();await runtime.request({type:'model.save',config,apiKey:'FAKE_DEEPSEEK',rememberKey:true});
  const load=vi.spyOn(vault,'load').mockRejectedValueOnce(new Error('无法读取本地凭据'));
  await expect(runtime.request({type:'model.save',config:qianfan})).rejects.toThrow('无法读取');expect(runtime.snapshot()).toMatchObject({config:{provider:'deepseek'},keyPresent:true});load.mockRestore();
  await runtime.request({type:'model.save',config:qianfan,apiKey:'FAKE_QIANFAN',rememberKey:true});
  const remove=vi.spyOn(vault,'delete').mockRejectedValueOnce(new Error('OS private detail'));
  await expect(runtime.request({type:'model.clearKey'})).rejects.toThrow('删除本地凭据失败');expect(runtime.snapshot()).toMatchObject({keyPresent:false,credential:{saved:true,error:expect.stringContaining('删除')}});expect(JSON.stringify(runtime.snapshot())).not.toContain('OS private');expect(await vault.load('deepseek')).toBe('FAKE_DEEPSEEK');remove.mockRestore();
  await runtime.request({type:'model.clearKey'});expect(await vault.load('qianfan')).toBeUndefined();await runtime.shutdown();
 }finally{await rm(root,{recursive:true,force:true});}
});
