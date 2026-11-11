// Runs the built desktop app against an isolated profile and fake credential; no paid API calls.
import {app,BrowserWindow,session} from 'electron';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
const root=process.env.WISP_QIANFAN_REPO,out=process.env.WISP_QIANFAN_VERIFY_DIR;
app.setPath('userData',join(out,'profile'));
const assert=(value,message)=>{if(!value)throw new Error(message);};
async function waitFor(read,accept){const deadline=Date.now()+10000;while(Date.now()<deadline){const result=await read();if(accept(result))return result;await new Promise(r=>setTimeout(r,30));}throw new Error('Desktop interaction timed out');}
let requests=0;const server=createServer((_req,res)=>{requests++;res.writeHead(500).end('No API request expected during settings');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const savedHttp={id:randomUUID(),name:'Unsupported HTTP fixture',transport:'streamable-http',url:`http://127.0.0.1:${server.address().port}/mcp`,command:'',args:[],envNames:[],envStorage:'none'};
await mkdir(join(out,'profile'),{recursive:true});await writeFile(join(out,'profile','mcp-servers.json'),JSON.stringify([savedHttp]));
void app.whenReady().then(async()=>{
 let forbidden=0;session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{const blocked=details.url.startsWith('https://qianfan.baidubce.com');if(blocked)forbidden++;callback({cancel:blocked});});
 await import(pathToFileURL(join(root,'apps/desktop/dist/main.js')).href);
 const window=await waitFor(()=>BrowserWindow.getAllWindows()[0],Boolean),wc=window.webContents;
 const execute=source=>wc.executeJavaScript(source);
 await waitFor(()=>execute('!!document.querySelector(".sidebar-bottom button")'),Boolean);
 await execute(`document.querySelector('.sidebar-bottom button').click()`);
 await waitFor(()=>execute('!!document.querySelector(".settings-page select")'),Boolean);
 await execute(`const select=document.querySelector('.settings-page select');select.value='qianfan';select.dispatchEvent(new Event('change',{bubbles:true}));`);
 await waitFor(()=>execute(`document.querySelector('.settings-page input[list]').value`),value=>value==='ernie-5.5-flash-preview');
 assert(await execute(`document.querySelector('.settings-page input[type=url]').value==='https://qianfan.baidubce.com/v2'`),'Wrong Qianfan preset URL');
 await execute(`const set=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};set(document.querySelector('.settings-page input[type=url]'),'http://127.0.0.1:${server.address().port}/v2');set(document.querySelector('.settings-page input[type=password]'),'FAKE_QIANFAN_DESKTOP_ONLY');`);
 await waitFor(()=>execute(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='保存并查看预置模型')?.disabled===false`),Boolean);
 await execute(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='保存并查看预置模型').click()`);
 await waitFor(()=>execute(`document.querySelector('.settings-page section:not([hidden]) [role=status]')?.textContent??''`),text=>text.includes('尚未验证 Key'));
 const result=await execute(`window.wisp.request({type:'snapshot'})`);
 assert(result.snapshot.config.provider==='qianfan'&&result.snapshot.config.model==='ernie-5.5-flash-preview','Desktop Host did not save the native provider');assert(result.snapshot.keyPresent,'Fake session key was not set');assert(result.snapshot.mcpServers.some(s=>s.id===savedHttp.id&&s.state==='failed'),'Unsupported MCP record was not isolated');assert(JSON.stringify(JSON.parse(await readFile(join(out,'profile','mcp-servers.json'),'utf8'))[0])===JSON.stringify(savedHttp),'Unsupported MCP configuration was changed');assert(!JSON.stringify(result).includes('FAKE_QIANFAN_DESKTOP_ONLY'),'Credential leaked to renderer');
 assert(await execute(`document.querySelector('.settings-page input[type=password]').value===''`),'Credential input not cleared');assert(requests===0&&forbidden===0,'Settings unexpectedly contacted an API');
 assert(!(await readFile(join(out,'profile','state.json'),'utf8')).includes('FAKE_QIANFAN_DESKTOP_ONLY'),'Credential persisted to state');
 await writeFile(join(out,'qianfan-settings.png'),(await wc.capturePage()).toPNG());
 const report={electron:process.versions.electron,platform:process.platform,provider:'qianfan',model:'ernie-5.5-flash-preview',presetUrl:true,privateIpcSave:true,presetQuery:true,credentialRedacted:true,credentialInputCleared:true,incompatibleMcpPreserved:true,apiRequests:requests,paidApiCalls:0};
 await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));server.closeAllConnections();server.close();app.quit();
}).catch(async error=>{console.error(error);for(const window of BrowserWindow.getAllWindows()){console.error(await window.webContents.executeJavaScript('document.querySelector(".settings-page")?.innerText'));await writeFile(join(out,'failure.png'),(await window.webContents.capturePage()).toPNG());}server.closeAllConnections();server.close();app.exit(1);});
