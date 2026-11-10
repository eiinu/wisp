import { contextBridge, ipcRenderer } from 'electron';
// Only the isolated native shell's main frame receives this preload. No Wisp bridge.
contextBridge.exposeInMainWorld('mcpApp',{
  send:(message:unknown)=>{if(message&&typeof message==='object'&&JSON.stringify(message).length<=65536)ipcRenderer.send('wisp:mcp-app-message',message);},
  subscribe:(callback:(input:unknown)=>void)=>{const listener=(_event:unknown,input:unknown)=>callback(input);ipcRenderer.on('wisp:mcp-app-delivery',listener);return()=>ipcRenderer.removeListener('wisp:mcp-app-delivery',listener);}
});
