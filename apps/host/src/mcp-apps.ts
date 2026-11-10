import {version as appVersion} from '../../../package.json';
import { randomUUID } from 'node:crypto';
import { AppBridge, RESOURCE_MIME_TYPE, SUPPORTED_PROTOCOL_VERSIONS, McpUiInitializeRequestSchema } from '@modelcontextprotocol/ext-apps/app-bridge';
import { JSONRPCMessageSchema, type JSONRPCMessage, type Tool as RemoteTool, type CallToolResult, type ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { DesktopService } from './desktop-service.js';

export type AppToolMeta = { resourceUri?: string; visibility: ('model'|'app')[] };
/** Validate rather than relying on SDK helpers that only test one metadata shape. */
export function appToolMeta(meta: unknown): AppToolMeta {
  if(meta===undefined)return {visibility:['model','app']};
  if(!meta||typeof meta!=='object'||Array.isArray(meta))throw new Error('Invalid MCP App metadata');
  const m=meta as Record<string,any>, ui=m.ui;
  if(ui!==undefined && (!ui||typeof ui!=='object'||Array.isArray(ui)))throw new Error('Invalid MCP App metadata');
  const uri=ui&&'resourceUri' in ui?ui.resourceUri:m['ui/resourceUri'], visibility=ui&&'visibility' in ui?ui.visibility:['model','app'];
  if(uri!==undefined&&(typeof uri!=='string'||!uri.startsWith('ui://')||uri.length>4096||/[\x00-\x20]/.test(uri)))throw new Error('Invalid MCP App resource URI');
  if(!Array.isArray(visibility)||!visibility.length||visibility.length>2||new Set(visibility).size!==visibility.length||visibility.some(v=>v!=='model'&&v!=='app'))throw new Error('Invalid MCP App visibility');
  return {resourceUri:uri,visibility};
}
export function appHtml(result: ReadResourceResult, uri:string): string {
  if(result.contents.length!==1)throw new Error('MCP App requires one HTML resource');
  const content=result.contents[0];
  if(content.uri!==uri||content.mimeType!==RESOURCE_MIME_TYPE)throw new Error('Invalid MCP App resource identity');
  const html='text' in content?content.text:Buffer.from(content.blob,'base64').toString('utf8');
  if(Buffer.byteLength(html)>2_000_000||!html.trim())throw new Error('MCP App HTML exceeds limit');
  // This host deliberately grants no network or device permissions, even when requested.
  return html;
}
export interface AppBinding {
  sessionId:string; serviceId:string; serviceName:string; tool:RemoteTool; args:Record<string,unknown>; result:CallToolResult;
  guard():void;
  read(uri:string,signal:AbortSignal):Promise<ReadResourceResult>;
  call(name:string,args:Record<string,unknown>,signal:AbortSignal):Promise<CallToolResult>;
}
type Instance={id:string;binding:AppBinding;bridge:AppBridge;transport:Transport;phase:'new'|'initializing'|'awaiting-initialized'|'ready'|'closing';abort:AbortController;timer?:ReturnType<typeof setTimeout>;busy:boolean;rate:{at:number;count:number};initializeId?:string|number};
/** No real Client is passed to AppBridge: it cannot silently bypass our authorization. */
export class McpApps {
  private instances=new Map<string,Instance>();
  constructor(private desktop:DesktopService,private sessionAllowed:(id:string)=>boolean){}
  private guard(i:Instance){if(this.instances.get(i.id)!==i||i.phase==='closing'||!this.sessionAllowed(i.binding.sessionId))throw new Error('MCP App session is no longer active');i.binding.guard();}
  async open(binding:AppBinding,signal:AbortSignal){
    binding.guard();if(!this.sessionAllowed(binding.sessionId))return;
    if(this.instances.size>=8)throw new Error('最多打开 8 个 MCP Apps');
    const meta=appToolMeta(binding.tool._meta);if(!meta.resourceUri)return;
    const html=appHtml(await binding.read(meta.resourceUri,signal),meta.resourceUri);binding.guard();signal.throwIfAborted();if(!this.sessionAllowed(binding.sessionId))throw new Error('MCP App session changed');
    const id=randomUUID(),abort=new AbortController();
    const bridge=new AppBridge(null,{name:'Wisp',version:appVersion},{serverTools:{},serverResources:{},openLinks:{},logging:{},sandbox:{csp:{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]},permissions:{}}},{hostContext:{platform:'desktop',displayMode:'inline',availableDisplayModes:['inline'],theme:'light',locale:'zh-CN',containerDimensions:{width:760,maxHeight:900},toolInfo:{tool:binding.tool}}});
    const transport:Transport={start:async()=>{},send:async message=>{if(this.instances.has(id)){if(i.phase==='initializing'&&'id' in message&&message.id===i.initializeId&&'result' in message)i.phase='awaiting-initialized';await this.desktop.call('mcp.apps.message',{id,message},abort.signal);}},close:async()=>{}};
    const i:Instance={id,binding,bridge,transport,phase:'new',abort,busy:false,rate:{at:Date.now(),count:0}};this.instances.set(id,i);
    bridge.onerror=()=>{};

    bridge.oninitialized=()=>{
      if(i.phase!=='awaiting-initialized')return;
      i.phase='ready';clearTimeout(i.timer);
      void (async()=>{this.guard(i);await bridge.sendToolInput({arguments:binding.args});await bridge.sendToolResult(binding.result);})().catch(()=>this.close(id));
    };
    const approve=async(title:string,detail:string,requestSignal:AbortSignal)=>{
      this.guard(i);if(i.phase!=='ready'||i.busy)throw new Error('App is not ready or an approval is pending');i.busy=true;
      try{const allowed=await this.desktop.call('mcp.apps.confirm',{id,title,detail},AbortSignal.any([abort.signal,requestSignal]));this.guard(i);if(!allowed)throw new Error('User denied MCP App request');}catch(e){i.busy=false;throw e;}
    };
    bridge.oncalltool=async(params,extra)=>{
      await approve('MCP App 工具调用',`${binding.serviceName}\n工具：${params.name}\n参数：${JSON.stringify(params.arguments??{})}`,extra.signal);
      try{this.guard(i);return await binding.call(params.name,params.arguments??{},AbortSignal.any([abort.signal,extra.signal]));}finally{i.busy=false;}
    };
    bridge.onreadresource=async(params,extra)=>{
      await approve('MCP App 读取服务资源',`${binding.serviceName}\n${params.uri}`,extra.signal);
      try{this.guard(i);return await binding.read(params.uri,AbortSignal.any([abort.signal,extra.signal]));}finally{i.busy=false;}
    };
    bridge.onopenlink=async({url},extra)=>{
      const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password||url.length>4096)throw new Error('Invalid external URL');
      await approve('MCP App 打开外部链接',parsed.href,extra.signal);
      try{this.guard(i);await this.desktop.call('mcp.apps.openLink',{id,url:parsed.href},abort.signal);return {};}finally{i.busy=false;}
    };
    bridge.onsizechange=({width,height})=>{try{this.guard(i);if(i.phase==='ready')void this.desktop.call('mcp.apps.resize',{id,width,height},abort.signal).catch(()=>{});}catch{}};
    bridge.onrequestdisplaymode=async()=>{this.guard(i);return {mode:'inline'};};
    bridge.onrequestteardown=()=>{void this.close(id);};
    // Model messages/context and file downloads are intentionally unsupported, never auto-forwarded.
    await bridge.connect(transport);
    i.timer=setTimeout(()=>{void this.close(id);},15000);
    try{await this.desktop.call('mcp.apps.open',{id,title:`MCP App · ${binding.serviceName}`,html},signal);}catch(e){await this.close(id);throw e;}
  }
  async receive(id:string,input:unknown){
    const i=this.instances.get(id);if(!i)return;
    if(Date.now()-i.rate.at>1000)i.rate={at:Date.now(),count:0};if(++i.rate.count>60){await this.close(id);return;}
    if(input==='closed'){await this.close(id);return;}
    try{
      if(i.phase==='closing'){const reply=JSONRPCMessageSchema.parse(input);if(!('method' in reply))i.transport.onmessage?.(reply);return;}
      this.guard(i);if(JSON.stringify(input).length>65536)throw new Error('App message too large');
      const message=JSONRPCMessageSchema.parse(input);
      if('method' in message){
        const method=message.method;
        if(method==='ui/initialize'){
          if(i.phase!=='new'||!SUPPORTED_PROTOCOL_VERSIONS.includes((message.params as any)?.protocolVersion))throw new Error('Invalid App initialization');
          McpUiInitializeRequestSchema.parse(message);i.initializeId='id' in message?message.id:undefined;i.phase='initializing';
        }else if(method==='ui/notifications/initialized'){
          if(i.phase!=='awaiting-initialized')throw new Error('Invalid App initialization order');
        }else if(i.phase!=='ready')throw new Error('App has not initialized');
        if(!['ui/initialize','ui/notifications/initialized','tools/call','resources/read','ui/open-link','ui/request-display-mode','ui/notifications/size-changed','ui/notifications/request-teardown','notifications/message','ping'].includes(method))throw new Error('Unsupported MCP App method');
      }
      i.transport.onmessage?.(message);
    }catch(error){
      const code=error instanceof Error&&error.message==='Unsupported MCP App method'?-32601:(error as any)?.name==='ZodError'?-32600:-32000;
      if(input&&typeof input==='object'&&'id' in input&&['string','number'].includes(typeof (input as any).id))await i.transport.send({jsonrpc:'2.0',id:(input as any).id,error:{code,message:'MCP App request rejected by host policy'}}).catch(()=>{});
    }
  }
  async close(id:string){const i=this.instances.get(id);if(!i||i.phase==='closing')return;i.phase='closing';clearTimeout(i.timer);
    try{await i.bridge.teardownResource({}, {timeout:1000});}catch{}
    this.instances.delete(id);i.abort.abort();await i.bridge.close().catch(()=>{});await this.desktop.call('mcp.apps.close',{id},AbortSignal.timeout(3000)).catch(()=>{});
  }
  async closeWhere(predicate:(b:AppBinding)=>boolean){await Promise.all([...this.instances.values()].filter(i=>predicate(i.binding)).map(i=>this.close(i.id)));}
}
