import type { BrowserBridge } from '../shared/browser.js';
import { contextBridge, ipcRenderer } from 'electron';
import type { WorkbenchBridge, Notice } from '@wisp/core';
const bridge: WorkbenchBridge & { browser: BrowserBridge; onBrowserOpen(callback: (url: string) => void): () => void; copyText(text: string): Promise<void>; chooseDirectory(): Promise<string | undefined>; openUrl(url: string): Promise<void> } = {
  browser: { command: command => ipcRenderer.invoke('wisp:browser', command), subscribe: callback => { const listener = (_event: unknown, state: Parameters<typeof callback>[0]) => callback(state); ipcRenderer.on('wisp:browser-state', listener); return () => ipcRenderer.removeListener('wisp:browser-state', listener); } },
  onBrowserOpen: callback => { const listener = (_event: unknown, url: string) => callback(url); ipcRenderer.on('wisp:browser-open-request', listener); return () => ipcRenderer.removeListener('wisp:browser-open-request', listener); },
  copyText: text => ipcRenderer.invoke('wisp:copy-text', text),
  request: request => ipcRenderer.invoke('wisp:request', request),
  subscribe: callback => { const listener = (_event: unknown, notice: Notice) => callback(notice); ipcRenderer.on('wisp:notice', listener); return () => ipcRenderer.removeListener('wisp:notice', listener); },
  openUrl: url => ipcRenderer.invoke('wisp:open-url', url),
  chooseDirectory: () => ipcRenderer.invoke('wisp:choose-directory'),
};
contextBridge.exposeInMainWorld('wisp', bridge);
