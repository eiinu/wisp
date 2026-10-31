import { contextBridge, ipcRenderer } from 'electron';
import type { WorkbenchBridge, Notice } from '@wisp/core';
const bridge: WorkbenchBridge & { copyText(text: string): Promise<void>; chooseDirectory(): Promise<string | undefined>; openUrl(url: string): Promise<void> } = {
  copyText: text => ipcRenderer.invoke('wisp:copy-text', text),
  request: request => ipcRenderer.invoke('wisp:request', request),
  subscribe: callback => { const listener = (_event: unknown, notice: Notice) => callback(notice); ipcRenderer.on('wisp:notice', listener); return () => ipcRenderer.removeListener('wisp:notice', listener); },
  openUrl: url => ipcRenderer.invoke('wisp:open-url', url),
  chooseDirectory: () => ipcRenderer.invoke('wisp:choose-directory'),
};
contextBridge.exposeInMainWorld('wisp', bridge);
