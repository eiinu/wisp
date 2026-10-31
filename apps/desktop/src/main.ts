import { trashOperation } from './trash.js';
import { createBrowser } from './browser.js';
import { credentialVault } from './credential-vault.js';
import { app, BrowserWindow, ipcMain, session, dialog, shell, safeStorage, clipboard } from 'electron';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { requestSchema, type Result } from '@wisp/core';
async function startDesktop() {
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
  let browser: ReturnType<typeof createBrowser> | undefined;
  ipcMain.handle('wisp:browser', (event, input) => { trusted(event); browser ??= createBrowser(window); return browser.command(input); });
  ipcMain.handle('wisp:request', (event, input: unknown) => {
    trusted(event); if (!host.connected) throw new Error('Local Host unavailable');
    const request = requestSchema.parse(input), id = randomUUID();
    return new Promise<Result>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Host 响应超时，请刷新状态确认结果')); }, 15000);
      pending.set(id, { resolve, reject, timer });
      host.send({ id, request }, error => { if (error) { clearTimeout(timer); pending.delete(id); reject(new Error('Host 连接失败')); } });
    });
  });
  ipcMain.handle('wisp:copy-text', (event, input: unknown) => { trusted(event); if (typeof input !== 'string' || input.length > 2_000_000) throw new Error('Invalid clipboard text'); clipboard.writeText(input); });
  ipcMain.handle('wisp:open-url', async (event, input: unknown) => { trusted(event); if (typeof input !== 'string' || input.length > 4096) throw new Error('Invalid URL'); const url = new URL(input); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Only web URLs are allowed'); await shell.openExternal(url.href); });
  ipcMain.handle('wisp:choose-directory', async event => { trusted(event); const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] }); return result.canceled ? undefined : result.filePaths[0]; });
  const desktopCalls = new Map<string, AbortController>();
  host.on('message', async (message: any) => {
    if(message?.type==='desktop-cancel'){desktopCalls.get(message.id)?.abort();return;}
    if(message?.type==='desktop-request'&&typeof message.id==='string'){
      if(desktopCalls.has(message.id))return;const controller=new AbortController();desktopCalls.set(message.id,controller);
      try {
        const value=message.operation?.startsWith('trash.') ? await trashOperation(message.operation,message.payload,app.getPath('userData'),controller.signal,shell.trashItem) : browser ? await browser.pageOperation(message.operation,message.payload,controller.signal) : (()=>{throw new Error('没有可读取的桌面网页标签');})();
        if(host.connected&&!controller.signal.aborted)host.send({type:'desktop-response',id:message.id,value});
      }catch(error){if(host.connected&&!controller.signal.aborted)host.send({type:'desktop-response',id:message.id,error:error instanceof Error?error.message:'桌面操作失败'});}
      finally{desktopCalls.delete(message.id);}
      return;
    }
    // Recheck the initial snapshot if it timed out while secure storage initialized.
    if (message?.type === 'host-ready') { if (!window.isDestroyed()) window.webContents.send('wisp:notice', { type: 'changed' }); return; }
    if (message?.type === 'credential-request' && typeof message.id === 'string') {
      try { let value: unknown; if (message.operation === 'available') value = await vault.available(); else if (message.operation === 'load') value = await vault.load(); else if (message.operation === 'delete') await vault.delete(); else if (message.operation === 'save' && typeof message.key === 'string' && message.key.length <= 4096) await vault.save(message.key); else throw new Error('Invalid credential operation'); if (host.connected) host.send({ type: 'credential-response', id: message.id, ok: true, value }); }
      catch { if (host.connected) host.send({ type: 'credential-response', id: message.id, ok: false }); }
      return;
    }
    if (message.type === 'notice' && !window.isDestroyed()) window.webContents.send('wisp:notice', message.notice);
    if (message.type === 'response') { const call = pending.get(message.id); if (call) { clearTimeout(call.timer); pending.delete(message.id); message.error ? call.reject(new Error(message.error)) : call.resolve(message.result); } }
  });
  const unavailable = () => { for(const controller of desktopCalls.values())controller.abort(); desktopCalls.clear(); for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Local Host stopped')); } pending.clear(); if (!window.isDestroyed()) window.webContents.send('wisp:notice', { type: 'disconnected', message: 'Host 已停止，请重新启动 Wisp' }); };
  host.on('exit', unavailable); host.on('error', unavailable);
  app.on('before-quit', () => { for(const controller of desktopCalls.values())controller.abort(); host.kill(); }); app.on('window-all-closed', () => app.quit());
  await window.loadURL(uiUrl);
}

// Electron releases its ESM startup gate only after this module finishes loading.
// Awaiting ready at module scope would wait on that same gate indefinitely.
void app.whenReady().then(startDesktop).catch(() => {
  dialog.showErrorBox('Wisp 启动失败', '无法启动本地工作台，请退出后重试。');
  app.quit();
});
