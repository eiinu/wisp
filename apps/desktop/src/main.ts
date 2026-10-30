import { credentialVault } from './credential-vault.js';
import { app, BrowserWindow, ipcMain, session, dialog, shell, safeStorage } from 'electron';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { requestSchema, type Result } from '@wisp/core';
await app.whenReady();
const vault = credentialVault(app.getPath('userData'), safeStorage);
const host = fork(fileURLToPath(new URL('../../host/dist/main.js', import.meta.url)), [app.getPath('userData'), '--secure-credentials'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
const window = new BrowserWindow({ width: 1320, height: 900, minWidth: 760, minHeight: 600, backgroundColor: '#ffffff', title: 'Wisp', webPreferences: {
  preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)), contextIsolation: true, nodeIntegration: false, sandbox: true,
} });
const pending = new Map<string, { resolve: (result: Result) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
const uiUrl = new URL('../ui-dist/index.html', import.meta.url).href;
session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
window.webContents.on('will-navigate', event => event.preventDefault());
function trusted(event: Electron.IpcMainInvokeEvent) { if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== uiUrl) throw new Error('Untrusted sender'); }
ipcMain.handle('wisp:request', (event, input: unknown) => {
  trusted(event); if (!host.connected) throw new Error('Local Host unavailable');
  const request = requestSchema.parse(input), id = randomUUID();
  return new Promise<Result>((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Host 响应超时，请刷新状态确认结果')); }, 15000);
    pending.set(id, { resolve, reject, timer });
    host.send({ id, request }, error => { if (error) { clearTimeout(timer); pending.delete(id); reject(new Error('Host 连接失败')); } });
  });
});
ipcMain.handle('wisp:open-url', async (event, input: unknown) => { trusted(event); if (typeof input !== 'string' || input.length > 4096) throw new Error('Invalid URL'); const url = new URL(input); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Only web URLs are allowed'); await shell.openExternal(url.href); });
ipcMain.handle('wisp:choose-directory', async event => { trusted(event); const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] }); return result.canceled ? undefined : result.filePaths[0]; });
host.on('message', async (message: any) => {
  if (message?.type === 'credential-request' && typeof message.id === 'string') {
    try { let value: unknown; if (message.operation === 'available') value = await vault.available(); else if (message.operation === 'load') value = await vault.load(); else if (message.operation === 'delete') await vault.delete(); else if (message.operation === 'save' && typeof message.key === 'string' && message.key.length <= 4096) await vault.save(message.key); else throw new Error('Invalid credential operation'); if (host.connected) host.send({ type: 'credential-response', id: message.id, ok: true, value }); }
    catch { if (host.connected) host.send({ type: 'credential-response', id: message.id, ok: false }); }
    return;
  }
  if (message.type === 'notice' && !window.isDestroyed()) window.webContents.send('wisp:notice', message.notice);
  if (message.type === 'response') { const call = pending.get(message.id); if (call) { clearTimeout(call.timer); pending.delete(message.id); message.error ? call.reject(new Error(message.error)) : call.resolve(message.result); } }
});
const unavailable = () => { for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Local Host stopped')); } pending.clear(); if (!window.isDestroyed()) window.webContents.send('wisp:notice', { type: 'disconnected', message: 'Host 已停止，请重新启动 Wisp' }); };
host.on('exit', unavailable); host.on('error', unavailable);
app.on('before-quit', () => host.kill()); app.on('window-all-closed', () => app.quit());
await window.loadURL(uiUrl);
