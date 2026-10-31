import { WebContentsView, session, type BrowserWindow, type DownloadItem } from 'electron';
import { randomUUID } from 'node:crypto';
import { browserUrl, type BrowserCommand, type BrowserDownload, type BrowserPage, type BrowserSnapshot } from '../shared/browser.js';

/** Remote content owns an ephemeral session, never the workbench session or preload. */
export function createBrowser(window: BrowserWindow) {
  const remote = session.fromPartition(`wisp-browser-${randomUUID()}`);
  remote.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  remote.setPermissionCheckHandler(() => false);
  const pages = new Map<string, { view: WebContentsView; state: BrowserPage; generation: number }>();
  const downloads = new Map<string, { item?: DownloadItem; state: BrowserDownload }>();
  let disposed = false;
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
    if (!page) {
      if (pages.size >= 12) throw new Error('最多打开 12 个网页标签');
      const view = new WebContentsView({ webPreferences: { session: remote, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, navigateOnDragDrop: false } });
      page = { view, generation: 0, state: { id, url, title: new URL(url).hostname, loading: true, back: false, forward: false } };
      pages.set(id, page); window.contentView.addChildView(view); view.setVisible(false);
      const wc = view.webContents, state = page.state;
      const sync = () => { if (wc.isDestroyed()) return; state.url = wc.getURL() || state.url; state.title = wc.getTitle() || state.title; state.loading = wc.isLoading(); state.back = wc.navigationHistory.canGoBack(); state.forward = wc.navigationHistory.canGoForward(); emit(); };
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
    if (!['snapshot', 'layout'].includes(input.type) && (!('id' in input) || typeof input.id !== 'string' || !input.id)) throw new Error('Invalid tab');
    if ('id' in input && input.id !== undefined && (typeof input.id !== 'string' || input.id.length > 4096)) throw new Error('Invalid tab');
    if (input.type === 'open') { const url = browserUrl(input.url); if (!url) throw new Error('仅允许 HTTP/HTTPS 网页'); open(input.id, url); }
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
  return { command, dispose };
}
