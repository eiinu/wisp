import { contextBridge, ipcRenderer } from 'electron';
import type { WorkbenchBridge, Notice } from '@wisp/core';
const bridge: WorkbenchBridge & { chooseDirectory(): Promise<string | undefined>; openUrl(url: string): Promise<void> } = {
  request: request => ipcRenderer.invoke('wisp:request', request),
  subscribe: callback => { const listener = (_event: unknown, notice: Notice) => callback(notice); ipcRenderer.on('wisp:notice', listener); return () => ipcRenderer.removeListener('wisp:notice', listener); },
  openUrl: url => ipcRenderer.invoke('wisp:open-url', url),
  chooseDirectory: () => ipcRenderer.invoke('wisp:choose-directory'),
};
contextBridge.exposeInMainWorld('wisp', bridge);
