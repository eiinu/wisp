import { app, BrowserWindow, dialog, shell } from 'electron';
import { createMcpAppWindows } from '../../apps/desktop/src/mcp-app-windows.js';
import { LocalMcp } from '../../apps/host/src/local-mcp.js';
import { McpApps } from '../../apps/host/src/mcp-apps.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
const out=process.env.WISP_APP_VERIFY_ROOT!,node=process.env.WISP_APP_VERIFY_NODE!;
app.setPath('userData',join(out,'electron-profile'));
const assert=(condition:unknown,message:string)=>{if(!condition)throw new Error(message);};
async function waitFor<T>(read:()=>T|Promise<T>,accept:(v:T)=>boolean,timeout=10000):Promise<T>{const start=Date.now();while(Date.now()-start<timeout){const value=await read();if(accept(value))return value;await new Promise(r=>setTimeout(r,30));}throw new Error('Timed out waiting for MCP App UI');}
void app.whenReady().then(async()=>{
 const parent=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
 let manager:LocalMcp,security:McpApps|undefined;
 const approvals:any[]=[],links:string[]=[];
 dialog.showMessageBox=(async(_window:unknown,options:unknown)=>{approvals.push(options);return {response:1,checkboxChecked:false};}) as any;
 shell.openExternal=async url=>{links.push(url);};
 let securityId='';
 const windows=createMcpAppWindows(parent,(id,message)=>{void (id===securityId?security?.receive(id,message):manager.receiveApp(id,message));});
 const desktop={call:async(op:string,payload:any,signal:AbortSignal)=>{if(op==='mcp.apps.open'&&payload.title.includes('security'))securityId=payload.id;try{const value=await windows.call(op,payload,signal);if(op==='mcp.apps.open'){const w=BrowserWindow.getAllWindows().find(w=>w!==parent);w?.webContents.on('console-message',details=>console.log('App console',details.message));}return value;}catch(error){console.error('Desktop test operation failed',op,error);throw error;}}};
 manager=new LocalMcp(await mkdtemp(join(tmpdir(),'wisp-app-data-')),()=>{},desktop,undefined,10000,()=>true);
 await manager.init();
 const report:any={platform:process.platform,electron:process.versions.electron,examples:[]};
 for(const [name,remoteName] of [['basic-server-vanillajs','get-time'],['budget-allocator-server','get-budget-data']]){
  const id=await manager.save(undefined,{name,command:node,args:[join(out,name,'stdio.mjs')]},undefined,false);await manager.activate(id);
  const tool=manager.tools('session').find(t=>t.source?.serviceId===id&&t.source.toolName===remoteName)!;assert(tool,`Missing official ${remoteName} tool`);
  const result=await(await tool.prepare!({},new AbortController().signal)).execute(new AbortController().signal);assert(JSON.parse(result).appStatus==='已在隔离窗口打开 MCP App',`App failed to open: ${result}`);
  const window=await waitFor(()=>BrowserWindow.getAllWindows().find(w=>w!==parent),Boolean);
  const frame=await waitFor(()=>window!.webContents.mainFrame.frames.find(f=>f.url==='about:srcdoc'),Boolean);
  if(name==='basic-server-vanillajs'){
   const before=await waitFor(()=>frame!.executeJavaScript('document.getElementById("server-time")?.textContent'),text=>typeof text==='string'&&/^\d{4}-/.test(text));
   await frame!.executeJavaScript('document.getElementById("get-time-btn").click()');
   await waitFor(()=>frame!.executeJavaScript('document.getElementById("server-time").textContent'),text=>text!==before&&/^\d{4}-/.test(text));
   assert(approvals.length>0,'UI tool call did not require approval');
  }else{
   await waitFor(()=>frame!.executeJavaScript('document.body.innerText'),text=>typeof text==='string'&&text.includes('Marketing'));
   assert(await frame!.executeJavaScript('document.querySelectorAll("canvas").length>0'),'Budget chart did not render');
  }
  await new Promise(r=>setTimeout(r,1000));assert(window!.getContentSize()[0]===760,'Host fixed-width context does not match native viewport');
  await writeFile(join(out,`${name}.png`),(await window!.webContents.capturePage()).toPNG());
  report.examples.push({name,tool:remoteName,rendered:true,approvals:approvals.length});await manager.disable(id);
 }
 if(process.env.WISP_TEST_SDK2){
  const server=spawn(node,[process.env.WISP_TEST_TODO_SERVER!],{env:{...process.env},stdio:['ignore','pipe','inherit']});
  try{
   const port=await new Promise<number>((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('Todo fixture start timeout')),10000);server.once('exit',()=>{clearTimeout(timer);reject(new Error('Todo fixture exited'));});server.stdout!.on('data',data=>{text+=String(data);const match=text.match(/PORT (\d+)/);if(match){clearTimeout(timer);resolve(Number(match[1]));}});});
   const id=await manager.save(undefined,{name:'Synthetic SDK2 Todo',command:'',args:[],transport:'streamable-http',url:`http://127.0.0.1:${port}/mcp`},undefined,false);await manager.activate(id);
   const tools=manager.tools('session').filter(t=>t.source?.serviceId===id);assert(tools.length===1&&tools[0].source?.toolName==='show_todos','Todo app-only helpers leaked to model');
   const text=await(await tools[0].prepare!({},new AbortController().signal)).execute(new AbortController().signal);assert(JSON.parse(text).appStatus==='已在隔离窗口打开 MCP App',text);
   const window=await waitFor(()=>BrowserWindow.getAllWindows().find(w=>w!==parent),Boolean);const frame=await waitFor(()=>window!.webContents.mainFrame.frames.find(f=>f.url==='about:srcdoc'),Boolean);
   await waitFor(()=>frame!.executeJavaScript('document.querySelectorAll("#todos li").length'),n=>n===1);
   await frame!.executeJavaScript('document.getElementById("text").value="Added synthetic task";document.getElementById("add").click()');
   await waitFor(()=>frame!.executeJavaScript('document.querySelectorAll("#todos li").length'),n=>n===2);
   await frame!.executeJavaScript('document.querySelector("#todos input").click()');await waitFor(()=>frame!.executeJavaScript('JSON.parse(document.getElementById("todos").dataset.state)[0].done'),Boolean);
   assert(approvals.length===3,'Todo mutations did not request individual approvals');await writeFile(join(out,'todo-sdk2.png'),(await window!.webContents.capturePage()).toPNG());report.todo={sdk:'ext-apps 2.0.4',transport:'Streamable HTTP',show:true,add:true,setDone:true,syntheticOnly:true};await manager.disable(id);
  }finally{server.kill('SIGTERM');}
 }
 let network=0;const probe=createServer((_req,res)=>{network++;res.end('forbidden');});await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as any).port;
 security=new McpApps(desktop,()=>true);
 const uri='ui://security/view';
 const html=`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src * data: blob: 'unsafe-inline'"><div id="report"></div><script>
 const r={node:typeof require,process:typeof process,wisp:typeof window.wisp,preload:typeof window.mcpApp};try{r.parent=parent.document.body.innerHTML}catch{r.parent='blocked'}try{r.storage=localStorage.length}catch{r.storage='blocked'}try{top.location='https://evil.invalid/'}catch{r.top='blocked'}fetch('http://127.0.0.1:${port}/fetch').catch(()=>{});window.open('http://127.0.0.1:${port}/popup');document.getElementById('report').textContent=JSON.stringify(r);
 </script><img id="allowed-image" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E"><img src="http://127.0.0.1:${port}/image"><iframe src="http://127.0.0.1:${port}/frame"></iframe><script src="http://127.0.0.1:${port}/script"></script>`;
 await security.open({sessionId:'session',serviceId:'security',serviceName:'security',tool:{name:'attack',inputSchema:{type:'object'},_meta:{ui:{resourceUri:uri}}},args:{},result:{content:[]},guard:()=>{},read:async()=>({contents:[{uri,mimeType:'text/html;profile=mcp-app',text:html}]}),call:async()=>({content:[]})},new AbortController().signal);
 const window=await waitFor(()=>BrowserWindow.getAllWindows().find(w=>w!==parent),Boolean);const frame=await waitFor(()=>window!.webContents.mainFrame.frames.find(f=>f.url==='about:srcdoc'),Boolean);
 const attack=JSON.parse(await waitFor(()=>frame!.executeJavaScript('document.getElementById("report")?.textContent'),Boolean));
 assert(['node','process','wisp','preload'].every(key=>attack[key]==='undefined'),'Third-party page obtained privileged API');assert(attack.parent==='blocked'&&attack.storage==='blocked'&&attack.top==='blocked','Sandbox boundary failed');
 await waitFor(()=>frame!.executeJavaScript('document.getElementById("allowed-image").naturalWidth'),width=>width===1);await new Promise(r=>setTimeout(r,200));assert(network===0,'Sandbox made forbidden network request');assert(BrowserWindow.getAllWindows().length===2,'Popup escaped sandbox');report.security={...attack,networkRequests:network};
 await security.close(securityId);await new Promise<void>(r=>probe.close(()=>r()));await manager.shutdown();windows.dispose();parent.destroy();await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.quit();
}).catch(error=>{console.error(error);for(const w of BrowserWindow.getAllWindows())console.error('App frames',w.webContents.mainFrame.frames.map(f=>({url:f.url.slice(0,100),name:f.name})));app.exit(1);});
