import { BrowserWindow, session, ipcMain, dialog, shell, type IpcMainEvent } from 'electron';
import { fileURLToPath } from 'node:url';
import { APP_SHELL_URL, sandboxedAppDocument } from './mcp-app-shell.js';
/** Third-party content has no Node, workbench IPC, persistent cookies, network or device grants. */
export function createMcpAppWindows(parent:BrowserWindow,receive:(id:string,message:unknown)=>void){
  const windows=new Map<string,{window:BrowserWindow;closing:boolean}>();
  const receiveMessage=(event:IpcMainEvent,message:unknown)=>{
    const found=[...windows.entries()].find(([,i])=>i.window.webContents===event.sender);
    if(!found||event.senderFrame!==event.sender.mainFrame||event.senderFrame?.url!==APP_SHELL_URL)return;
    if(!message||typeof message!=='object'||JSON.stringify(message).length>65536)return;
    receive(found[0],message);
  };
  ipcMain.on('wisp:mcp-app-message',receiveMessage);
  async function call(operation:string,payload:Record<string,any>,signal:AbortSignal){
    signal.throwIfAborted();const id=payload.id;
    if(typeof id!=='string'||! /^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid MCP App instance');
    if(operation==='mcp.apps.open'){
      if(windows.has(id)||windows.size>=8||typeof payload.html!=='string'||Buffer.byteLength(payload.html)>2_000_000)throw new Error('Invalid MCP App document');
      const remote=session.fromPartition(`wisp-mcp-app-${id}`);
      remote.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));remote.setPermissionCheckHandler(()=>false);
      remote.on('will-download',event=>event.preventDefault());
      // Defense in depth for CSP: no remote, file, custom-scheme or worker requests.
      remote.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('data:')&&!details.url.startsWith('blob:')&&details.url!=='about:blank'&&details.url!=='about:srcdoc'}));
      const window=new BrowserWindow({parent,width:760,height:650,useContentSize:true,resizable:false,minWidth:760,maxWidth:760,minHeight:240,title:String(payload.title).slice(0,150),show:false,webPreferences:{session:remote,preload:fileURLToPath(new URL('./mcp-app-preload.cjs',import.meta.url)),nodeIntegration:false,nodeIntegrationInSubFrames:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,navigateOnDragDrop:false,webviewTag:false}});
      const entry={window,closing:false};windows.set(id,entry);window.setMenu(null);
      window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      window.webContents.on('will-navigate',event=>event.preventDefault());
      window.webContents.on('will-frame-navigate',event=>{if(event.url!=='about:srcdoc'&&event.url!=='about:blank')event.preventDefault();});
      window.webContents.on('will-redirect',event=>event.preventDefault());window.webContents.on('will-attach-webview',event=>event.preventDefault());
      window.on('close',event=>{if(!entry.closing){event.preventDefault();receive(id,'closed');}});
      window.on('closed',()=>{windows.delete(id);void remote.clearStorageData().catch(()=>{});});
      window.webContents.on('render-process-gone',()=>receive(id,'closed'));
      try{await window.loadURL(APP_SHELL_URL);signal.throwIfAborted();window.webContents.send('wisp:mcp-app-delivery',{type:'load',html:sandboxedAppDocument(payload.html)});window.show();}
      catch(error){entry.closing=true;window.destroy();throw error;}
      return true;
    }
    const entry=windows.get(id);if(!entry||entry.window.isDestroyed())throw new Error('MCP App window closed');
    const window=entry.window;
    if(operation==='mcp.apps.message'){if(JSON.stringify(payload.message).length>3_000_000)throw new Error('App message too large');window.webContents.send('wisp:mcp-app-delivery',{type:'message',message:payload.message});return true;}
    if(operation==='mcp.apps.confirm'){
      const result=await dialog.showMessageBox(window,{type:'question',title:String(payload.title).slice(0,120),message:String(payload.title).slice(0,120),detail:String(payload.detail).slice(0,35000),buttons:['拒绝','允许本次'],defaultId:0,cancelId:0,noLink:true});signal.throwIfAborted();return result.response===1;
    }
    if(operation==='mcp.apps.openLink'){const url=new URL(payload.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Invalid external link');await shell.openExternal(url.href);return true;}
    if(operation==='mcp.apps.resize'){
      const [width,height]=window.getContentSize();window.setContentSize(760,Number.isFinite(payload.height)?Math.max(240,Math.min(900,Math.round(payload.height))):height);return true;
    }
    if(operation==='mcp.apps.close'){entry.closing=true;window.destroy();return true;}
    throw new Error('Invalid MCP App operation');
  }
  return {call,dispose:()=>{ipcMain.removeListener('wisp:mcp-app-message',receiveMessage);for(const i of windows.values()){i.closing=true;i.window.destroy();}windows.clear();}};
}
