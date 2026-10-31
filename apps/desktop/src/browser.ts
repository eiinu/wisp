import { extractPage, publicPageUrl, boundedRead } from './page-content.js';
import { WebContentsView, session, dialog, type BrowserWindow, type DownloadItem } from 'electron';
import { randomUUID } from 'node:crypto';
import { browserUrl, type BrowserCommand, type BrowserDownload, type BrowserPage, type BrowserSnapshot } from '../shared/browser.js';

/** Remote content owns an ephemeral session, never the workbench session or preload. */
export function createBrowser(window: BrowserWindow) {
  const remote = session.fromPartition(`wisp-browser-${randomUUID()}`);
  remote.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  remote.setPermissionCheckHandler(() => false);
  const pages = new Map<string, { view: WebContentsView; state: BrowserPage; generation: number; owner?: string; publicId: string }>();
  const downloads = new Map<string, { item?: DownloadItem; state: BrowserDownload }>();
  let disposed = false, currentSession: string | undefined, activeTab: string | undefined;
  const readTickets = new Map<string, {tabId:string;sessionId:string;generation:number;url:string;expires:number}>();
  const snapshot = (): BrowserSnapshot => ({ pages: [...pages.values()].map(p => ({ ...p.state })), downloads: [...downloads.values()].map(d => ({ ...d.state })) });
  const emit = () => { if (!disposed && !window.isDestroyed()) window.webContents.send('wisp:browser-state', snapshot()); };
  const download = (event: Electron.Event, item: DownloadItem, contents: Electron.WebContents) => {
    if (![...pages.values()].some(p => p.view.webContents === contents) || !browserUrl(item.getURL())) { event.preventDefault(); return; }
    // No setSavePath: Electron presents its native Save dialog, including overwrite confirmation.
    item.setSaveDialogOptions({ title: '保存下载文件', buttonLabel: '保存' });
    const id = randomUUID();
    const state: BrowserDownload = { id, name: item.getFilename(), url: item.getURL(), received: 0, total: item.getTotalBytes(), state: 'progressing' };
    downloads.set(id, { item, state });
    const update = (_event: unknown, status: BrowserDownload['state']) => { state.received = item.getReceivedBytes(); state.total = item.getTotalBytes(); state.state = status; emit(); };
    item.on('updated', update);
    item.once('done', (event, status) => { update(event, status); item.removeListener('updated', update); downloads.get(id)!.item = undefined; });
    emit();
  };
  remote.on('will-download', download);
  function close(id: string) {
    const page = pages.get(id); if (!page) return;
    pages.delete(id); window.contentView.removeChildView(page.view);
    page.view.webContents.removeAllListeners(); if (!page.view.webContents.isDestroyed()) page.view.webContents.close({ waitForBeforeUnload: false });
  }
  function open(id: string, url: string) {
    let page = pages.get(id);
    if (page && page.owner !== currentSession) throw new Error('标签属于另一个会话');
    if (!page) {
      if (pages.size >= 12) throw new Error('最多打开 12 个网页标签');
      const view = new WebContentsView({ webPreferences: { session: remote, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, navigateOnDragDrop: false } });
      page = { view, generation: 0, publicId: randomUUID(), owner: currentSession, state: { id, url, title: new URL(url).hostname, loading: true, back: false, forward: false } };
      pages.set(id, page); window.contentView.addChildView(view); view.setVisible(false);
      const wc = view.webContents, state = page.state;
      const sync = () => { if (wc.isDestroyed()) return; state.url = wc.getURL() || state.url; state.title = wc.getTitle() || state.title; state.loading = wc.isLoading(); state.back = wc.navigationHistory.canGoBack(); state.forward = wc.navigationHistory.canGoForward(); emit(); };
      wc.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) page!.generation++; });
      wc.on('did-start-loading', sync); wc.on('did-stop-loading', sync); wc.on('did-navigate', sync); wc.on('did-navigate-in-page', sync); wc.on('page-title-updated', sync);
      wc.on('will-navigate', (event, target) => { if (!browserUrl(target)) event.preventDefault(); });
      wc.on('will-redirect', (event, target) => { if (!browserUrl(target)) event.preventDefault(); });
      wc.on('will-frame-navigate', event => { if (!browserUrl(event.url) && event.url !== 'about:blank') event.preventDefault(); });
      wc.on('will-attach-webview', event => event.preventDefault());
      // Popup intent goes through the workbench confirmation UI; it never creates a remote window.
      wc.setWindowOpenHandler(({ url }) => { const safe = browserUrl(url); if (safe && !window.isDestroyed()) window.webContents.send('wisp:browser-open-request', safe); return { action: 'deny' }; });
      wc.on('did-fail-load', (_event, code, description, _url, mainFrame) => { if (mainFrame && code !== -3) { state.error = description; state.loading = false; emit(); } });
      wc.on('render-process-gone', () => { state.error = '网页进程已停止，请刷新'; state.loading = false; emit(); });
    }
    page.state.error = undefined; page.state.loading = true; page.state.url = url;
    const generation = ++page.generation;
    void page.view.webContents.loadURL(url).catch((error: unknown) => { if (pages.get(id) === page && generation === page.generation && !(error instanceof Error && error.message.includes('ERR_ABORTED'))) { page.state.error ??= '网页加载失败'; page.state.loading = false; emit(); } });
  }
  function command(input: BrowserCommand): BrowserSnapshot {
    if (!input || typeof input !== 'object' || disposed) throw new Error('Browser unavailable');
    if (!['snapshot', 'layout', 'context'].includes(input.type) && (!('id' in input) || typeof input.id !== 'string' || !input.id)) throw new Error('Invalid tab');
    if ('id' in input && input.id !== undefined && (typeof input.id !== 'string' || input.id.length > 4096)) throw new Error('Invalid tab');
    if (input.type === 'context') { if (input.sessionId !== undefined && (typeof input.sessionId !== 'string' || input.sessionId.length > 100)) throw new Error('Invalid session'); if(currentSession !== input.sessionId) readTickets.clear(); currentSession=input.sessionId; activeTab=input.id; }
    else if (input.type === 'open') { const url = browserUrl(input.url); if (!url) throw new Error('仅允许 HTTP/HTTPS 网页'); open(input.id, url); }
    else if (input.type === 'close') close(input.id);
    else if (input.type === 'layout') {
      for (const page of pages.values()) page.view.setVisible(false);
      const page = input.id && pages.get(input.id), b = input.bounds;
      if (page && b) {
        const [width, height] = window.getContentSize();
        if (![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.x < 0 || b.y < 0 || b.width < 1 || b.height < 1 || b.x + b.width > width + 1 || b.y + b.height > height + 1) throw new Error('Invalid browser bounds');
        page.view.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }); page.view.setVisible(true);
      }
    } else if (input.type === 'cancel-download') downloads.get(input.id)?.item?.cancel();
    else if (['back', 'forward', 'reload'].includes(input.type)) {
      const page = pages.get((input as {id: string}).id); if (!page) throw new Error('网页已关闭');
      page.state.error = undefined;
      const wc = page.view.webContents;
      if (input.type === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      if (input.type === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
      if (input.type === 'reload') wc.reload();
    } else if (input.type !== 'snapshot') throw new Error('Unknown browser command');
    emit(); return snapshot();
  }
  const hide = () => { for (const page of pages.values()) page.view.setVisible(false); };
  window.on('resize', hide);
  function dispose() { if (disposed) return; disposed = true; remote.removeListener('will-download', download); window.removeListener('resize', hide); for (const id of pages.keys()) close(id); for (const d of downloads.values()) d.item?.cancel(); }
  // Detach children before BrowserWindow destroys its native contentView.
  window.once('close', dispose);
  async function pageOperation(operation:string,payload:Record<string,unknown>,signal:AbortSignal) {
    signal.throwIfAborted(); if(disposed || !currentSession || payload.sessionId!==currentSession) throw new Error('网页不属于当前会话');
    if(operation==='page.list')return {pages:[...pages.entries()].filter(([,p])=>p.owner===currentSession).map(([id,p])=>({id,ref:p.publicId,version:p.generation,title:p.view.webContents.getTitle().slice(0,300),url:publicPageUrl(p.view.webContents.getURL()||p.state.url),loading:p.view.webContents.isLoading(),error:!!p.state.error}))};
    if(operation==='page.action') {
      const entry=[...pages].find(([,p])=>p.publicId===payload.tabId),id=entry?.[0],page=entry?.[1];
      const valid=()=>page&&id&&pages.get(id)===page&&page.owner===currentSession&&payload.sessionId===currentSession&&!page.view.webContents.isDestroyed()&&payload.version===page.generation;
      if(!valid())throw new Error('标签已关闭或导航改变，请重新获取列表');
      const wc=page!.view.webContents,action=payload.action;
      if(!['reload','back','forward','close'].includes(String(action)))throw new Error('不支持的标签操作');
      if(action==='back'&&!wc.navigationHistory.canGoBack())throw new Error('此标签没有后退历史');
      if(action==='forward'&&!wc.navigationHistory.canGoForward())throw new Error('此标签没有前进历史');
      if(action==='close') {
        // BrowserView unload handling varies by Electron version. Explicit native consent
        // protects unsaved content even when the embedded view ignores beforeunload.
        const choice=await dialog.showMessageBox(window,{type:'warning',title:'关闭网页标签',message:'关闭此网页？未保存的内容可能丢失。',detail:`${wc.getTitle().slice(0,300)}\n${publicPageUrl(wc.getURL())}`,buttons:['保留标签','关闭标签'],defaultId:0,cancelId:0,noLink:true});
        signal.throwIfAborted();if(!valid())throw new Error('确认期间标签或会话已改变');
        if(choice.response!==1)return {status:'cancelled'};
        return new Promise<{status:string}>((resolve,reject)=>{
          const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);wc.removeListener('destroyed',done);wc.removeListener('will-prevent-unload',prevented);};
          const done=()=>{cleanup();pages.delete(id!);if(!window.isDestroyed())window.contentView.removeChildView(page!.view);emit();resolve({status:'closed'});};
          const prevented=()=>{cleanup();resolve({status:'cancelled'});}; // Never preventDefault: that would override the page's refusal.
          const abort=()=>{cleanup();reject(new Error('关闭等待已取消；请重新获取标签状态'));};
          const timer=setTimeout(()=>{cleanup();reject(new Error('关闭状态未知；请重新获取标签列表'));},8000);
          wc.once('destroyed',done);wc.once('will-prevent-unload',prevented);signal.addEventListener('abort',abort,{once:true});
          wc.close({waitForBeforeUnload:true});
        });
      }
      signal.throwIfAborted();page!.generation++;page!.state.error=undefined;
      if(action==='reload')wc.reload();else if(action==='back')wc.navigationHistory.goBack();else wc.navigationHistory.goForward();
      emit();return {status:'navigation_requested'};
    }
    if(operation==='page.bind') {
      for(const [id,t] of readTickets) if(t.expires<Date.now())readTickets.delete(id);
      if(readTickets.size>=32)throw new Error('并发读取过多，请稍后重试');
      const tabId=typeof payload.tabId==='string' ? [...pages].find(([,p])=>p.publicId===payload.tabId)?.[0] : undefined;
      const page=tabId&&pages.get(tabId);if(!page || page.owner!==currentSession)throw new Error('此会话没有可读取的网页标签');
      if(payload.version!==page.generation)throw new Error('页面导航已改变，请重新获取标签列表');
      const wc=page.view.webContents,url=wc.getURL();
      if(wc.isDestroyed()||wc.isLoading()||page.state.error||!browserUrl(url))throw new Error('网页未加载完成或已失败，请先打开并等待加载');
      const ticket=randomUUID();readTickets.set(ticket,{tabId:tabId!,sessionId:currentSession,generation:page.generation,url,expires:Date.now()+300000});
      return {ticket,tabId:page.publicId,title:wc.getTitle().slice(0,300),url:publicPageUrl(url)};
    }
    if(operation!=='page.read'||typeof payload.ticket!=='string')throw new Error('不支持的网页操作');
    const ticket=readTickets.get(payload.ticket);readTickets.delete(payload.ticket);
    if(!ticket||ticket.sessionId!==currentSession||ticket.expires<Date.now())throw new Error('读取绑定已过期或已消费');
    const page=pages.get(ticket.tabId),wc=page?.view.webContents;
    const unchanged=()=>page&&pages.get(ticket.tabId)===page&&!wc!.isDestroyed()&&page.owner===currentSession&&currentSession===ticket.sessionId&&page.generation===ticket.generation&&wc!.getURL()===ticket.url&&!wc!.isLoading()&&!page.state.error;
    if(!unchanged())throw new Error('页面导航或标签状态已改变，请重新获取标签列表');
    signal.throwIfAborted();
    const result=await boundedRead(wc!.executeJavaScriptInIsolatedWorld(999,[{code:`(${extractPage.toString()})()`}]), AbortSignal.any([signal,AbortSignal.timeout(8000)]));
    signal.throwIfAborted();if(!unchanged())throw new Error('读取期间页面已改变，结果已丢弃');
    if(!result||typeof result.text!=='string'||result.text.length>24000||!Array.isArray(result.links))throw new Error('网页提取结果无效');
    return {tabId:page!.publicId,url:publicPageUrl(ticket.url),title:String(result.title).slice(0,300),text:result.text,links:result.links.slice(0,60),truncated:!!result.truncated};
  }
  return { command, dispose, pageOperation };
}
