import { afterEach, expect, it, vi } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalMcp, mcpToolName, type McpTransportFactory } from '../apps/host/src/local-mcp.js';
import { Agent } from '../apps/host/src/agent.js';
import { EventLog } from '../apps/host/src/log.js';
import type { RunEvent } from '../packages/core/src/index.js';
const cleanup:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const work of cleanup.splice(0).reverse())await work();});
async function setup(options:{wait?:boolean;error?:boolean;duplicate?:boolean;timeout?:number}={}){
 const directory=await mkdtemp(join(tmpdir(),'wisp-mcp-'));cleanup.push(()=>rm(directory,{recursive:true,force:true}));
 const servers:Server[]=[],calls:any[]=[];let changed=false;
 const factory:McpTransportFactory=params=>{const [client,transport]=InMemoryTransport.createLinkedPair();const server=new Server({name:'fixture',version:'1'},{capabilities:{tools:{listChanged:true}}});servers.push(server);
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:(options.duplicate?['same','same']:changed?['next.tool']:['echo.tool']).map(name=>({name,description:'untrusted description',annotations:{readOnlyHint:true},inputSchema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',properties:{text:{type:'string'},count:{type:'number',minimum:1}},required:['text'],additionalProperties:false}}))}));
 server.setRequestHandler(CallToolRequestSchema,async(req,extra)=>{calls.push(req.params);if(options.wait)await new Promise<void>(resolve=>extra.signal.addEventListener('abort',()=>resolve(),{once:true}));return {isError:options.error,content:[{type:'text',text: String(req.params.arguments?.text??'')} ,{type:'image',data:'T01JVFRFRA==',mimeType:'image/png'}]};});
 void server.connect(transport);return client;};
 const vault=new Map<string,unknown>();const desktop={call:vi.fn(async(op:string,payload:any)=>{if(op.endsWith('save'))vault.set(payload.id,{env:payload.env,binding:payload.binding});if(op.endsWith('load'))return vault.get(payload.id);if(op.endsWith('delete'))vault.delete(payload.id);})};
 const mcp=new LocalMcp(directory,()=>{},desktop,factory,options.timeout??500);await mcp.init();cleanup.push(()=>mcp.shutdown());
 const id=await mcp.save(undefined,{name:'Fixture',command:'fixture',args:[]},undefined,false);
 return {directory,mcp,id,servers,calls,desktop,vault,factory,change:async()=>{changed=true;await servers[0]!.notification({method:'notifications/tools/list_changed'});}};
}
it('starts empty; config defaults disabled, secrets never serialized, restart requires activation',async()=>{
 const f=await setup();expect(f.mcp.snapshot()[0]!.state).toBe('disabled');expect(f.servers).toHaveLength(0);expect(f.desktop.call).not.toHaveBeenCalled();
 await f.mcp.save(f.id,{name:'Fixture',command:'fixture',args:[]},{TOKEN:'fake-secret-123'},true);
 expect(await readFile(join(f.directory,'mcp-servers.json'),'utf8')).not.toContain('fake-secret-123');expect(JSON.stringify(f.mcp.snapshot())).not.toContain('fake-secret-123');
 const restart=new LocalMcp(f.directory,()=>{},f.desktop,f.factory);await restart.init();cleanup.push(()=>restart.shutdown());expect(restart.tools()).toHaveLength(0);
 await restart.activate(f.id);expect(f.desktop.call).toHaveBeenCalledWith('mcp.env.load',{id:f.id},expect.any(AbortSignal));
 const tool=restart.tools()[0]!;expect(tool.requiresApproval).toBe(true);const result=await (await tool.prepare!({text:'fake-secret-123'},new AbortController().signal)).execute(new AbortController().signal);expect(result).toContain('[REDACTED]');expect(result).not.toContain('T01JVFRFRA==');
 await restart.disable(f.id);await restart.delete(f.id);expect(restart.snapshot()).toHaveLength(0);expect(f.vault.size).toBe(0);
});
it('rejects invalid args, namespaced collisions, stale approval after dynamic tools change and disabled connection',async()=>{
 const f=await setup();await f.mcp.activate(f.id);const tool=f.mcp.tools()[0]!,signal=new AbortController().signal;
 expect(()=>tool.validate!({text:12})).toThrow('JSON Schema');const approved=await tool.prepare!({text:'okay'},signal);
 await f.change();await vi.waitFor(()=>expect(f.mcp.tools()[0]?.source?.toolName).toBe('next.tool'));
 await expect(approved.execute(signal)).rejects.toThrow('改变');expect(f.calls).toHaveLength(0);
 expect(mcpToolName(f.id,'a.b')).not.toBe(mcpToolName(f.id,'a_b'));expect(mcpToolName(f.id,'a'.repeat(150))).toMatch(/^[a-z0-9_]{1,64}$/);
 const other=await f.mcp.save(undefined,{name:'Fixture',command:'fixture',args:[]},undefined,false);await f.mcp.activate(other);expect(new Set(f.mcp.tools().map(t=>t.name)).size).toBe(2);
 const next=f.mcp.tools()[0]!;await f.mcp.disable(f.id);await expect(next.prepare!({text:'x'},signal)).rejects.toThrow();
});
it('fails closed on duplicate listing and crashes without automatically restarting',async()=>{
 const duplicate=await setup({duplicate:true});await expect(duplicate.mcp.activate(duplicate.id)).rejects.toThrow();expect(duplicate.mcp.snapshot()[0]?.state).toBe('failed');
 const f=await setup();await f.mcp.activate(f.id);await f.servers[0]!.close();await vi.waitFor(()=>expect(f.mcp.snapshot()[0]?.state).toBe('failed'));expect(f.mcp.tools()).toHaveLength(0);expect(f.servers).toHaveLength(1);
});
it('cancels inflight calls on disable and reports timeout or server failure without replay',async()=>{
 const f=await setup({wait:true});await f.mcp.activate(f.id);const signal=new AbortController().signal;
 const prepared=await f.mcp.tools()[0]!.prepare!({text:'wait'},signal);const call=prepared.execute(signal);const rejected=expect(call).rejects.toThrow();await vi.waitFor(()=>expect(f.calls).toHaveLength(1));await f.mcp.disable(f.id);await rejected;
 const timeout=await setup({wait:true,timeout:30});await timeout.mcp.activate(timeout.id);await expect((await timeout.mcp.tools()[0]!.prepare!({text:'wait'},signal)).execute(signal)).rejects.toThrow('超时');expect(timeout.calls).toHaveLength(1);
 const error=await setup({error:true});await error.mcp.activate(error.id);await expect((await error.mcp.tools()[0]!.prepare!({text:'x'},signal)).execute(signal)).rejects.toThrow('失败');
});
it('requires approval even for readOnlyHint; Agent continuation gets tool result and source UI metadata',async()=>{
 const f=await setup();await f.mcp.activate(f.id);const name=f.mcp.tools()[0]!.name;const events:RunEvent[]=[];let allowed=true;
 const agent=new Agent({generate:async messages=>messages.some(m=>m.role==='tool')?{text:messages.at(-1)!.text}:{text:'',calls:[{id:'one',name,args:{text:'fixture reply'}}]}},()=>f.mcp.tools(),new EventLog(join(f.directory,'events.jsonl')),e=>{events.push(e);if(e.type==='approval_requested')agent.approve(e.runId,String(e.data.id),allowed);});
 await agent.run('test');expect(f.calls).toHaveLength(1);expect(events.find(e=>e.type==='tool_requested')?.data.source).toMatchObject({serviceName:'Fixture',toolName:'echo.tool'});expect(events.find(e=>e.type==='assistant')?.data.text).toContain('fixture reply');
 allowed=false;await agent.run('denied');expect(f.calls).toHaveLength(1);expect(events.some(e=>e.type==='tool_result'&&e.data.denied)).toBe(true);
});
it('session env expires on restart; changing command cannot reuse existing secrets; secure failure does not fall back',async()=>{
 const f=await setup();await f.mcp.save(f.id,{name:'Fixture',command:'fixture',args:[]},{TOKEN:'only-memory'},false);
 await expect(f.mcp.save(f.id,{name:'Other',command:'other',args:[]},undefined,false)).rejects.toThrow('重新提供');
 const restart=new LocalMcp(f.directory,()=>{},f.desktop,f.factory);cleanup.push(()=>restart.shutdown());await restart.init();await expect(restart.activate(f.id)).rejects.toThrow();expect(f.servers).toHaveLength(0);
 f.desktop.call.mockRejectedValueOnce(new Error('secure unavailable'));await expect(f.mcp.save(f.id,{name:'Fixture',command:'fixture',args:[]},{TOKEN:'never-plain'},true)).rejects.toThrow();expect(await readFile(join(f.directory,'mcp-servers.json'),'utf8')).not.toContain('never-plain');
});
it('spawns an actual stdio fixture with argument arrays and closes it; start failure is sanitized',async()=>{
 const f=await setup();const manager=new LocalMcp(f.directory,()=>{});cleanup.push(()=>manager.shutdown());await manager.init();
 const id=await manager.save(undefined,{name:'stdio',command:process.execPath,args:[join(process.cwd(),'scripts/fixtures/mcp-stdio.mjs')]},{FAKE_MCP_SECRET:'fake-only'},false);
 await manager.activate(id);const signal=new AbortController().signal;expect(await(await manager.tools()[0]!.prepare!({text:'semicolon ; $(no-shell)'},signal)).execute(signal)).toContain('semicolon ; $(no-shell)');
 await manager.disable(id);expect(manager.tools()).toHaveLength(0);
 const fail=await manager.save(undefined,{name:'bad',command:'/missing/fake-secret-command',args:[]},undefined,false);
 await expect(manager.activate(fail)).rejects.toThrow('启动');expect(JSON.stringify(manager.snapshot().find(s=>s.id===fail)?.message)).not.toContain('fake-secret-command');
});
it('binds encrypted environments to the executable and rejects mismatched vault state before spawning',async()=>{
 const f=await setup();await f.mcp.save(f.id,{name:'Fixture',command:'fixture',args:[]},{TOKEN:'binding-secret'},true);
 f.vault.set(f.id,{env:{TOKEN:'binding-secret'},binding:'not-the-command'});
 const restart=new LocalMcp(f.directory,()=>{},f.desktop,f.factory);cleanup.push(()=>restart.shutdown());await restart.init();
 await expect(restart.activate(f.id)).rejects.toThrow();expect(f.servers).toHaveLength(0);
});
it('bounds results and aborts an explicit cancellation without re-executing',async()=>{
 const f=await setup();await f.mcp.activate(f.id);const signal=new AbortController().signal;
 const result=JSON.parse(await(await f.mcp.tools()[0]!.prepare!({text:'x'.repeat(40000)},signal)).execute(signal));
 expect(result.truncated).toBe(true);expect(result.data).toHaveLength(32000);
 const waiting=await setup({wait:true});await waiting.mcp.activate(waiting.id);const controller=new AbortController();
 const call=(await waiting.mcp.tools()[0]!.prepare!({text:'cancel'},controller.signal)).execute(controller.signal);const rejected=expect(call).rejects.toThrow();
 await vi.waitFor(()=>expect(waiting.calls).toHaveLength(1));controller.abort();await rejected;
 expect(waiting.mcp.tools()).toHaveLength(0);expect(waiting.calls).toHaveLength(1);
});
it('paginates discovery and enforces the global tool budget even during concurrent activation',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wisp-mcp-pages-'));cleanup.push(()=>rm(directory,{recursive:true,force:true}));
 const cursors:(string|undefined)[]=[];
 const manager=new LocalMcp(directory,()=>{},undefined,()=>{
  const [client,transport]=InMemoryTransport.createLinkedPair(),server=new Server({name:'pages',version:'1'},{capabilities:{tools:{}}});
  server.setRequestHandler(ListToolsRequestSchema,async req=>{const cursor=req.params?.cursor;cursors.push(cursor);return{tools:Array.from({length:25},(_,i)=>({name:`tool_${cursor??'first'}_${i}`,inputSchema:{type:'object' as const,properties:{}}})),...cursor?{}:{nextCursor:'second'}};});
  void server.connect(transport);return client;
 });cleanup.push(()=>manager.shutdown());await manager.init();
 const a=await manager.save(undefined,{name:'A',command:'fixture',args:[]},undefined,false),b=await manager.save(undefined,{name:'B',command:'fixture',args:[]},undefined,false);
 const results=await Promise.allSettled([manager.activate(a),manager.activate(b)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(manager.tools()).toHaveLength(50);expect(cursors).toContain('second');
});
it('does not corrupt approval IDs or numeric schemas when env contains a short flag value',async()=>{
 const f=await setup();await f.mcp.save(f.id,{name:'Fixture',command:'fixture',args:[]},{FLAG:'1'},false);await f.mcp.activate(f.id);
 const tool=f.mcp.tools()[0]!,events:RunEvent[]=[];
 expect(tool.inputSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');expect(tool.inputSchema.properties).toMatchObject({count:{minimum:1}});
 const agent=new Agent({generate:async messages=>messages.some(m=>m.role==='tool')?{text:'done'}:{text:'',calls:[{id:'call-1',name:tool.name,args:{text:'private flag 1'}}]}},()=>f.mcp.tools(),new EventLog(join(f.directory,'short-env.jsonl')),e=>{events.push(e);if(e.type==='approval_requested')agent.approve(e.runId,String(e.data.id),true);},f.id,f.mcp.redact,f.mcp.redactionLength);
 await agent.run('short flag test');expect(events.some(e=>e.type==='completed')).toBe(true);expect(f.calls).toHaveLength(1);
 expect(events.find(e=>e.type==='tool_requested')?.data.source).toMatchObject({serviceId:f.id});
 expect(events.find(e=>e.type==='tool_result')?.data.callId).toBe('call-1');expect(events.find(e=>e.type==='tool_result')?.data.text).toContain('private flag [REDACTED]');
});
