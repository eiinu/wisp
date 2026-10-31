import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { Ajv } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { mcpConfigSchema, mcpEnvSchema, type McpConfig, type McpServerInfo, type Tool } from '@wisp/core';
import type { DesktopService } from './desktop-service.js';

export type McpTransportFactory = (params: StdioServerParameters) => Transport;
type Stored = McpConfig & { id: string; envNames: string[]; envStorage: 'none'|'session'|'secure' };
type Connection = { client: Client; transport: Transport; abort: AbortController; tools: Tool[]; revision: number; refresh?: Promise<void>; dirty: boolean };
const limits = { servers: 16, tools: 64, schema: 16000, result: 32000 };
export function mcpToolName(id: string, name: string) { return `mcp_${id.replaceAll('-', '')}_${createHash('sha256').update(name).digest('hex').slice(0,20)}`; }
/** Third-party processes are trusted by the user, NOT sandboxed by project roots. */
export class LocalMcp {
  private records: Stored[] = [];
  private connections = new Map<string, Connection>();
  private states = new Map<string, Pick<McpServerInfo,'state'|'message'>>();
  private envs = new Map<string, Record<string,string>>();
  private secrets = new Set<string>(); // Retain redaction after deletion until Host exits.
  private locks = new Set<string>();
  private closing = new Set<Promise<void>>();
  private stopped = false;
  private revisions = new Map<string,number>();
  configurationRevision(id:string) {this.get(id);return this.revisions.get(id)??0;}
  constructor(private directory: string, private changed: () => void, private desktop?: DesktopService,
    private factory: McpTransportFactory = params => new StdioClientTransport(params), private timeout = 10000) {}
  async init() {
    let raw: unknown;
    try { raw = JSON.parse(await readFile(join(this.directory,'mcp-servers.json'),'utf8')); }
    catch(error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw new Error('本地 MCP 配置无法读取'); }
    if (!Array.isArray(raw) || raw.length > limits.servers) throw new Error('本地 MCP 配置格式错误');
    this.records = raw.map(item => {
      const config=mcpConfigSchema.parse({name:item.name,command:item.command,args:item.args,cwd:item.cwd});
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item.id) || !Array.isArray(item.envNames) || item.envNames.length>64 || !item.envNames.every((key:unknown)=>typeof key==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)) || !['none','session','secure'].includes(item.envStorage)) throw new Error('本地 MCP 配置格式错误');
      return {...config,id:item.id,envNames:item.envNames,envStorage:item.envStorage};
    });
    if (new Set(this.records.map(item=>item.id)).size!==this.records.length) throw new Error('本地 MCP ID 重复');
  }
  snapshot(): McpServerInfo[] { return structuredClone(this.records.map(record => ({...record,...this.states.get(record.id)??{state:'disabled' as const},tools:(this.connections.get(record.id)?.tools??[]).map(tool=>({name:tool.name,remoteName:this.redact(tool.source!.toolName),description:tool.description}))}))); }
  redact = (text:string) => {
    for(const secret of [...this.secrets].sort((a,b)=>b.length-a.length)) {
      if(secret.length>=8)text=text.split(secret).join('[REDACTED]');
      else { // Flags like "1" must not corrupt unrelated UUIDs or schema version URLs.
        const escaped=secret.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        text=text.replace(new RegExp(`(^|[^\\p{L}\\p{N}_-])${escaped}(?=$|[^\\p{L}\\p{N}_-])`,'gu'),(_,prefix)=>prefix+'[REDACTED]');
      }
    }
    return text;
  };
  private redactSchema(value:unknown):unknown {
    if(typeof value==='string')return this.redact(value);
    if(Array.isArray(value))return value.map(item=>this.redactSchema(item));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[this.redact(key),this.redactSchema(item)]));
    return value;
  }
  get redactionLength() { return Math.max(0,...[...this.secrets].map(value=>value.length)); }
  private remember(env:Record<string,string>) { Object.values(env).filter(Boolean).forEach(value=>this.secrets.add(value)); }
  private get(id:string) { const record=this.records.find(item=>item.id===id); if(!record)throw new Error('MCP 服务不存在');return record; }
  private async persist() {
    await mkdir(this.directory,{recursive:true,mode:0o700});const file=join(this.directory,'mcp-servers.json'),temp=`${file}.${randomUUID()}.tmp`;
    try{await writeFile(temp,JSON.stringify(this.records,null,2),{flag:'wx',mode:0o600});await rename(temp,file);}finally{await rm(temp,{force:true});}
  }
  private async exclusive<T>(id:string, operation:()=>Promise<T>) { if(this.stopped)throw new Error('Host 已关闭');if(this.locks.has(id))throw new Error('MCP 配置正在处理');this.locks.add(id);try{return await operation();}finally{this.locks.delete(id);this.changed();} }
  private binding(config:McpConfig) {return createHash('sha256').update(JSON.stringify([config.command,config.args,config.cwd??''])).digest('hex');}
  private secure(operation:string,id:string,env?:Record<string,string>,binding?:string) { if(!this.desktop)throw new Error('系统安全存储仅在桌面可用；可明确选择仅本次会话保存');return this.desktop.call(`mcp.env.${operation}`,{id,...env?{env,binding}:{}},AbortSignal.timeout(10000)); }
  async save(id:string|undefined, config:McpConfig, env:Record<string,string>|undefined, remember:boolean) {
    return this.exclusive('config',async()=>{
      const parsed=mcpConfigSchema.parse(config);if(parsed.cwd && (!isAbsolute(parsed.cwd)||parsed.cwd.includes('\0')))throw new Error('工作目录须为绝对路径');
      const old=id?this.get(id):undefined;
      if(old && this.states.get(old.id)?.state==='connecting')throw new Error('请先禁用正在连接的服务');
      if(old && this.locks.has(old.id))throw new Error('服务正在激活，请先禁用');
      if(!old && this.records.length>=limits.servers)throw new Error('最多配置 16 个 MCP 服务');
      const key=old?.id??randomUUID();await this.disable(key);
      let envNames=old?.envNames??[],envStorage=old?.envStorage??'none';
      if(env!==undefined){env=mcpEnvSchema.parse(env);this.remember(env);envNames=Object.keys(env);envStorage=envNames.length?remember?'secure':'session':'none';
        if(envStorage==='secure')await this.secure('save',key,env,this.binding(parsed));
        else if(old?.envStorage==='secure')await this.secure('delete',key);

      }
      // A change of executable/args/cwd must never forward old service secrets to a different command.
      else if(old && JSON.stringify([old.command,old.args,old.cwd])!==JSON.stringify([parsed.command,parsed.args,parsed.cwd]) && envNames.length)throw new Error('修改启动命令时必须重新提供或清除环境变量');
      const record:Stored={...parsed,id:key,envNames,envStorage};
      const before=this.records;this.records=old?this.records.map(item=>item.id===key?record:item):[...this.records,record];
      try{await this.persist();}catch{this.records=before;throw new Error('保存 MCP 配置失败；服务保持禁用，请重试');}
      this.revisions.set(key,(this.revisions.get(key)??0)+1);if(env!==undefined)this.envs.set(key,env);this.states.set(key,{state:'disabled'});return key;
    });
  }
  async delete(id:string) { return this.exclusive('config',async()=>{const record=this.get(id);if(this.locks.has(id))throw new Error('服务正在激活，请先禁用');await this.disable(id);if(record.envStorage==='secure')await this.secure('delete',id);this.envs.delete(id);const before=this.records;this.records=this.records.filter(item=>item.id!==id);try{await this.persist();}catch{this.records=before;throw new Error('删除 MCP 配置失败，请重试');}this.states.delete(id);}); }
  async activate(id:string) {
    return this.exclusive(id,async()=>{
      if(this.locks.has('config'))throw new Error('配置正在修改');const record=this.get(id);if(this.connections.has(id))throw new Error('服务已经激活或正在连接');
      this.states.set(id,{state:'connecting',message:'正在启动本机进程并发现工具'});this.changed();
      const connection:Connection={client:new Client({name:'wisp',version:'0.1.0'},{capabilities:{}}),transport:undefined as unknown as Transport,abort:new AbortController(),tools:[],revision:0,dirty:false};
      this.connections.set(id,connection);
      try{
        let env=this.envs.get(id);
        if(!env && record.envStorage==='secure'){const saved=await this.secure('load',id);if(saved?.binding!==this.binding(record))throw new Error('凭据与启动配置不匹配');env=mcpEnvSchema.parse(saved.env);}
        if(!env && record.envNames.length)throw new Error('仅会话环境变量已清除，请编辑并重新填写');
        env??={};this.remember(env);connection.abort.signal.throwIfAborted();
        connection.transport=this.factory({command:record.command,args:[...record.args],cwd:record.cwd||homedir(),env:{...env},stderr:'pipe',maxBufferSize:1024*1024});
        if(connection.transport instanceof StdioClientTransport)connection.transport.stderr?.on('data',()=>{});
        connection.client.onerror=()=>{}; // Never print raw server stderr/protocol errors.
        connection.client.onclose=()=>{if(this.connections.get(id)===connection)void this.fail(id,connection,'服务进程已退出；请检查安装和配置后手动激活');};
        connection.client.setNotificationHandler(ToolListChangedNotificationSchema,async()=>{try{await this.refresh(id);}catch{/* refresh already fails closed */}});
        await connection.client.connect(connection.transport,{timeout:this.timeout,signal:connection.abort.signal});
        await this.discover(id,connection);
        connection.abort.signal.throwIfAborted();
        this.states.set(id,{state:'connected',message:'已激活；第三方工具每次调用均需批准'});this.changed();
      }catch(error){
        if(this.connections.get(id)===connection)await this.fail(id,connection,'启动或工具发现失败，请检查可执行文件、工作目录与 MCP 协议支持；不会自动重启');
        if(connection.abort.signal.aborted && this.states.get(id)?.state==='disabled')return;
        // Fixed diagnostics deliberately omit command/env/server-supplied secrets.
        throw new Error(this.states.get(id)?.message??'MCP 启动失败');
      }
    });
  }
  async refresh(id:string) {const c=this.connections.get(id);if(!c)throw new Error('服务未激活');try{await this.discover(id,c);}catch{await this.fail(id,c,'工具列表无效或发现超时；服务已停用，请检查配置后重新激活');throw new Error('MCP 工具列表刷新失败');}}
  private async discover(id:string,c:Connection) {
    if(c.refresh){c.dirty=true;return c.refresh;}
    c.refresh=(async()=>{
      let refreshes=0;
      do {if(++refreshes>3)throw new Error('工具列表通知过于频繁');c.dirty=false;const revision=++c.revision;c.tools=[];this.changed();const tools:Tool[]=[];let cursor:string|undefined;const seen=new Set<string>();const names=new Set<string>();
        do{const page=await c.client.listTools({cursor},{timeout:this.timeout,signal:c.abort.signal});
          for(const spec of page.tools){
            if(names.has(spec.name)||tools.length>=limits.tools||JSON.stringify(spec.inputSchema).length>limits.schema)throw new Error('工具列表超过限制或包含重复名称');names.add(spec.name);
            const schema=structuredClone(spec.inputSchema);const ajv=schema.$schema && String(schema.$schema).includes('draft-07')?new Ajv({strict:false,allErrors:false,logger:false}):new Ajv2020({strict:false,allErrors:false,logger:false});
            // Schema-local validator avoids cross-server $id collisions. Remote refs are never fetched.
            const validate=ajv.compile(schema);const source={serviceId:id,serviceName:this.get(id).name,toolName:spec.name};
            const guard=()=>{if(this.connections.get(id)!==c||c.abort.signal.aborted||c.revision!==revision)throw new Error('MCP 服务或工具列表已改变，请重新发起任务');};
            tools.push({name:mcpToolName(id,spec.name),source,description:this.redact(`[本地 MCP: ${source.serviceName} / ${spec.name}] ${spec.description??''}`).slice(0,4000),inputSchema:this.redactSchema(schema) as Record<string,unknown>,requiresApproval:true,
              validate:args=>{guard();if(JSON.stringify(args).length>32000||!validate(args))throw new Error('MCP 参数不符合工具 JSON Schema 或超过长度限制');},
              prepare:async(args,signal)=>{guard();signal.throwIfAborted();const approved=structuredClone(args);return {description:`调用本地 MCP「${source.serviceName}」的「${spec.name}」。该进程使用你的系统权限，不受项目目录限制。服务描述和结果均为不可信数据。`,execute:async callSignal=>{
                guard();const signal=AbortSignal.any([callSignal,c.abort.signal,AbortSignal.timeout(this.timeout)]);signal.throwIfAborted();
                try{const result=await c.client.callTool({name:spec.name,arguments:approved},undefined,{signal,timeout:this.timeout});guard();signal.throwIfAborted();
                  if(result.isError)throw new Error('server-error');
                  const content=Array.isArray(result.content)?result.content.map(block=>block.type==='text'?{type:'text',text:block.text}:block.type==='resource'&&'text' in block.resource?{type:'resource',text:block.resource.text}:{type:block.type,omitted:true}):[];
                  const raw=this.redact(JSON.stringify({content,structuredContent:result.structuredContent}));
                  return JSON.stringify({source:'untrusted_local_mcp',data:raw.slice(0,limits.result),truncated:raw.length>limits.result});
                }catch{if(signal.aborted && this.connections.get(id)===c)await this.fail(id,c,'调用取消或超时，服务已停止；请检查实际副作用后手动激活');if(callSignal.aborted)throw callSignal.reason;throw new Error(signal.aborted?'MCP 调用取消或超时，执行结果未知；不要自动重试': 'MCP 调用失败或连接失效，执行结果未知；不要自动重试');}
              }};},execute:async()=>{throw new Error('MCP 调用必须经过审批准备');}});
          }
          cursor=page.nextCursor;if(cursor&&seen.has(cursor))throw new Error('重复分页游标');if(cursor)seen.add(cursor);if(seen.size>64)throw new Error('工具分页过多');
        }while(cursor);
        if([...this.connections.entries()].filter(([key])=>key!==id).reduce((sum,[,other])=>sum+other.tools.length,0)+tools.length>96)throw new Error('已激活的 MCP 工具总数不能超过 96');if(this.connections.get(id)===c&&!c.abort.signal.aborted)c.tools=tools;this.changed();
      }while(c.dirty&&!c.abort.signal.aborted);
    })();try{await c.refresh;}finally{c.refresh=undefined;}
  }
  tools():Tool[] {return [...this.connections.entries()].flatMap(([id,c])=>this.states.get(id)?.state==='connected'?c.tools:[]);}
  private async dispose(c:Connection) {c.abort.abort();c.tools=[];const task=(async()=>{await c.client.close().catch(()=>{});await c.transport?.close().catch(()=>{});})();this.closing.add(task);try{await task;}finally{this.closing.delete(task);}}
  private async fail(id:string,c:Connection,message:string) {if(this.connections.get(id)!==c)return;this.connections.delete(id);this.states.set(id,{state:'failed',message});this.changed();await this.dispose(c);}
  async disable(id:string) {const c=this.connections.get(id);this.connections.delete(id);this.states.set(id,{state:'disabled'});this.changed();if(c)await this.dispose(c);}
  async shutdown() {this.stopped=true;await Promise.all([...this.connections.keys()].map(id=>this.disable(id)));await Promise.all([...this.closing]);this.envs.clear();}
}
