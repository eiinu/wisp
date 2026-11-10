import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../apps/host/node_modules/@modelcontextprotocol/ext-apps/dist/src/app.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { McpApps, appHtml, appToolMeta, type AppBinding } from '../apps/host/src/mcp-apps.js';
import { APP_SHELL, APP_CSP, sandboxedAppDocument } from '../apps/desktop/src/mcp-app-shell.js';
const clean:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const f of clean.splice(0).reverse())await f();});
const result={content:[{type:'text' as const,text:'counter 1'}],structuredContent:{counter:1},_meta:{private:'UI_ONLY'}};
const tool={name:'show-counter',inputSchema:{type:'object' as const},_meta:{ui:{resourceUri:'ui://counter/view'}}};
async function setup(){
 let id='',allowed=true,valid=true,selected=true;
 const sent:any[]=[],operations:any[]=[];
 const appTransport:Transport={start:async()=>{},close:async()=>{},send:async message=>{await host.receive(id,message);}};
 const desktop={call:vi.fn(async(op:string,payload:any)=>{operations.push({op,payload});if(op==='mcp.apps.open'){id=payload.id;return true;}if(op==='mcp.apps.message'){sent.push(payload.message);appTransport.onmessage?.(payload.message);return true;}if(op==='mcp.apps.confirm')return allowed;return true;})};
 const host=new McpApps(desktop,()=>selected),call=vi.fn(async()=>result),read=vi.fn(async(uri:string)=>({contents:[{uri,mimeType:'text/html;profile=mcp-app',text:'<!doctype html><h1>counter</h1>'}]}));
 const binding:AppBinding={sessionId:'session',serviceId:'server',serviceName:'Counter',tool,args:{counter:1},result,guard:()=>{if(!valid)throw new Error('stale');},call,read};
 await host.open(binding,new AbortController().signal);clean.push(()=>host.closeWhere(()=>true));
 return {host,id,desktop,sent,operations,call,read,binding,appTransport,deny:()=>{allowed=false;},invalidate:()=>{valid=false;},switchSession:()=>{selected=false;}};
}
it('validates resource metadata and model/app membership, including deprecated resource key',()=>{
 expect(appToolMeta(undefined).visibility).toEqual(['model','app']);expect(appToolMeta({ui:{visibility:['app']}}).visibility).toEqual(['app']);
 expect(appToolMeta({'ui/resourceUri':'ui://legacy/view'}).resourceUri).toBe('ui://legacy/view');
 for(const meta of [{ui:{visibility:null}},{ui:{resourceUri:null}},{ui:{visibility:[]}},{ui:{visibility:['model','bad']}},{ui:{visibility:['app','app']}},{ui:{resourceUri:'https://example.com'}},{ui:[]}])expect(()=>appToolMeta(meta)).toThrow();
 expect(()=>appHtml({contents:[{uri:'ui://x',mimeType:'text/html',text:'bad'}]},'ui://x')).toThrow();
 expect(()=>appHtml({contents:[{uri:'ui://other',mimeType:'text/html;profile=mcp-app',text:'bad'}]},'ui://x')).toThrow();
 expect(appHtml({contents:[{uri:'ui://x',mimeType:'text/html;profile=mcp-app',blob:Buffer.from('<h1>x</h1>').toString('base64')}]},'ui://x')).toContain('<h1>');
});
it('interoperates with official App SDK: initialize, ordered input/result, proxy calls, resources, deny, link and teardown',async()=>{
 const f=await setup();const app=new App({name:'official-sdk-fixture',version:'1'},{},{autoResize:false}),received:string[]=[];
 app.ontoolinput=p=>{expect(p.arguments).toEqual({counter:1});received.push('input');};
 app.ontoolresult=p=>{expect(p).toMatchObject(result);received.push('result');};
 await app.connect(f.appTransport);await vi.waitFor(()=>expect(received).toEqual(['input','result']));
 expect(app.getHostCapabilities()).toMatchObject({serverTools:{},serverResources:{},sandbox:{permissions:{}}});
 expect(await app.callServerTool({name:'increment',arguments:{amount:1}})).toMatchObject(result);expect(f.call).toHaveBeenCalledOnce();
 await app.readServerResource({uri:'resource://counter/data'});expect(f.read).toHaveBeenCalledTimes(2);
 await app.openLink({url:'https://example.com/'});expect(f.operations.some(o=>o.op==='mcp.apps.openLink')).toBe(true);
 f.deny();await expect(app.callServerTool({name:'increment',arguments:{amount:1}})).rejects.toThrow();expect(f.call).toHaveBeenCalledOnce();
 await expect(app.openLink({url:'file:///etc/passwd'})).rejects.toThrow();
 await expect(app.sendMessage({role:'user',content:[{type:'text',text:'injected'}]})).rejects.toThrow();
 app.onteardown=async()=>({});await f.host.close(f.id);expect(f.operations.at(-1).op).toBe('mcp.apps.close');await app.close();
});
it('blocks pre-init actions, invalid/repeated handshake, unsupported methods, stale connections and switched sessions independently of SDK',async()=>{
 const f=await setup();
 const send=(id:number,method:string,params:any={})=>f.host.receive(f.id,{jsonrpc:'2.0',id,method,params});
 await send(1,'tools/call',{name:'increment'});expect(f.call).not.toHaveBeenCalled();expect(f.sent.at(-1).error).toBeTruthy();
 await send(2,'ui/initialize',{protocolVersion:'2026-01-26'});expect(f.sent.at(-1).error).toBeTruthy();
 await f.host.receive(f.id,{jsonrpc:'2.0',method:'ui/notifications/initialized'});await send(3,'tools/call',{name:'increment'});expect(f.call).not.toHaveBeenCalled();
 const app=new App({name:'fixture',version:'1'},{},{autoResize:false});await app.connect(f.appTransport);
 await send(4,'ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'again',version:'1'},appCapabilities:{}});expect(f.sent.at(-1).error).toBeTruthy();
 await send(5,'sampling/createMessage',{});expect(f.sent.at(-1).error).toBeTruthy();
 f.invalidate();await expect(app.callServerTool({name:'increment'})).rejects.toThrow();expect(f.call).not.toHaveBeenCalled();
 f.switchSession();await send(6,'resources/read',{uri:'file:///secret'});expect(f.read).toHaveBeenCalledTimes(1);
 app.onteardown=async()=>({});await app.close();
});
it('constructs the sandbox and policy before any untrusted markup, with no Node/workbench bridge or external network grants',()=>{
 const html=sandboxedAppDocument('<script>fetch("https://evil.test")</script>');expect(html.indexOf(APP_CSP)).toBeLessThan(html.indexOf('fetch('));
 expect(APP_CSP).toContain("connect-src 'none'");expect(APP_CSP).toContain("frame-src 'none'");expect(APP_CSP).toContain("base-uri 'none'");
 expect(APP_SHELL).toContain('sandbox="allow-scripts"');expect(APP_SHELL).not.toContain('allow-same-origin');expect(APP_SHELL).toContain('event.source===frame.contentWindow');expect(APP_SHELL).not.toContain('window.wisp');
});

it('uses the originating MCP connection for resources/tools, hides app-only tools and never exposes UI-private metadata to model results',async()=>{
 const {Server}=await import('@modelcontextprotocol/sdk/server/index.js');const {InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js');
 const {ListToolsRequestSchema,CallToolRequestSchema,ReadResourceRequestSchema}=await import('@modelcontextprotocol/sdk/types.js');
 const {LocalMcp}=await import('../apps/host/src/local-mcp.js');const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const directory=await mkdtemp(join(tmpdir(),'wisp-app-connection-'));clean.push(()=>rm(directory,{recursive:true,force:true}));
 const calls:any[]=[],reads:string[]=[],servers:InstanceType<typeof Server>[]=[];let appId='';const sent:any[]=[];
 const transport:Transport={start:async()=>{},close:async()=>{},send:async message=>manager.receiveApp(appId,message)};
 const desktop={call:async(op:string,p:any)=>{if(op==='mcp.apps.open')appId=p.id;if(op==='mcp.apps.confirm')return true;if(op==='mcp.apps.message'){sent.push(p.message);transport.onmessage?.(p.message);}return true;}};
 const factory=()=>{const [client,remote]=InMemoryTransport.createLinkedPair();const server=new Server({name:'app-server',version:'1'},{capabilities:{tools:{listChanged:true},resources:{}}});servers.push(server);
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[tool,{name:'increment',inputSchema:{type:'object',properties:{amount:{type:'number'}},required:['amount'],additionalProperties:false},_meta:{ui:{visibility:['app']}}},{name:'model-only',inputSchema:{type:'object'},_meta:{ui:{visibility:['model']}}}]}));
  server.setRequestHandler(CallToolRequestSchema,async r=>{calls.push(r.params);return result;});
  server.setRequestHandler(ReadResourceRequestSchema,async r=>{reads.push(r.params.uri);return {contents:[{uri:r.params.uri,mimeType:'text/html;profile=mcp-app',text:'<h1>UI_HTML_PRIVATE</h1>'}]};});void server.connect(remote);return client;
 };
 const manager=new LocalMcp(directory,()=>{},desktop,factory,1000,()=>true);await manager.init();clean.push(()=>manager.shutdown());const serviceId=await manager.save(undefined,{name:'Counter',command:'fixture',args:[]},undefined,false);await manager.activate(serviceId);
 expect(servers[0].getClientCapabilities()).toMatchObject({extensions:{'io.modelcontextprotocol/ui':{mimeTypes:['text/html;profile=mcp-app']}}});
 const tools=manager.tools('session');expect(tools.map(t=>t.source?.toolName)).toEqual(['show-counter','model-only']);
 const text=await(await tools[0].prepare!({counter:1},new AbortController().signal)).execute(new AbortController().signal);expect(text).not.toContain('UI_ONLY');expect(text).not.toContain('_meta');expect(text).not.toContain('UI_HTML_PRIVATE');expect(text).toContain('counter 1');expect(reads).toEqual(['ui://counter/view']);
 const app=new App({name:'connection-fixture',version:'1'},{},{autoResize:false});await app.connect(transport);
 await expect(app.callServerTool({name:'model-only'})).rejects.toThrow();await expect(app.callServerTool({name:'increment',arguments:{amount:'bad'}})).rejects.toThrow();expect(calls).toHaveLength(1);
 await app.callServerTool({name:'increment',arguments:{amount:2}});expect(calls).toHaveLength(2);expect(calls[1].name).toBe('increment');
 app.onteardown=async()=>({});await manager.refresh(serviceId);await expect(app.callServerTool({name:'increment',arguments:{amount:3}},{timeout:100})).rejects.toThrow();expect(calls).toHaveLength(2);await app.close();
});
