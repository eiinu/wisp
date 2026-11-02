import {afterEach,it,expect,vi} from 'vitest';
import {createServer,type ServerResponse} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Runtime} from '../apps/host/src/runtime.js';
import {Agent} from '../apps/host/src/agent.js';
import {Subagents} from '../apps/host/src/subagents.js';
import {EventLog} from '../apps/host/src/log.js';
import {WorkspaceFiles} from '../apps/host/src/files.js';
import type {RunEvent,GenerationProvider,Tool} from '../packages/core/src/index.js';
const cleanup:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const f of cleanup.splice(0).reverse())await f();});
async function dir(){const p=await mkdtemp(join(tmpdir(),'wisp-subagents-'));cleanup.push(()=>rm(p,{recursive:true,force:true}));return p;}
function respond(res:ServerResponse,text:string,calls?:{name:string;args:unknown;id?:string}[]){
 const delta=calls?{tool_calls:calls.map((c,index)=>({index,id:c.id??`call-${index}`,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{content:text};
 res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:calls?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
}
async function httpRuntime(handler:(body:any,res:ServerResponse)=>void){
 const server=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;handler(JSON.parse(text),res);});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));cleanup.push(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
 const path=await dir(),runtime=new Runtime(path,undefined,undefined,{baseUrl:`http://127.0.0.1:${(server.address() as any).port}`,key:'fixture-not-real'});
 await runtime.init();cleanup.push(()=>runtime.shutdown());const sessionId=(await runtime.request({type:'session.create'})).sessionId!;
 return {runtime,sessionId,path};
}
it('overlaps real child HTTP requests, keeps parent usable, snapshots persona and tools, and joins results for summary',async()=>{
 const held:ServerResponse[]=[],bodies:any[]=[];let parentContinued=false;
 const {runtime,sessionId,path}=await httpRuntime((body,res)=>{
  bodies.push(body);const child=body.messages[1].content.startsWith('Subtask:');
  if(child){held.push(res);return;}
  const toolMessages=body.messages.filter((m:any)=>m.role==='tool');
  if(!toolMessages.length){respond(res,'',[{name:'agent_spawn',args:{title:'A',task:'first',context:'only this fact'}},{name:'agent_spawn',args:{title:'B',task:'second'}}]);return;}
  parentContinued=true;
  if(body.messages.at(-1).content.startsWith('Wisp Host subtask completion report')){respond(res,'summary of A and B');return;}
  respond(res,'parent work before joining');
 });
 await runtime.request({type:'assistant.save',text:'Original persona'});
 await runtime.request({type:'run.start',sessionId,prompt:'delegate without sharing full request'});
 await vi.waitFor(()=>{expect(held).toHaveLength(2);expect(parentContinued).toBe(true);});
 const before=runtime.snapshot();const parent=before.events.find(e=>e.type==='started'&&!e.parentRunId)!;
 expect(before.sessions[0].activeRunId).toBe(parent.runId);
 expect(before.events.filter(e=>e.parentRunId&&e.type==='started')).toHaveLength(2);
 expect(before.events.some(e=>e.type==='completed')).toBe(false);
 await runtime.request({type:'assistant.save',text:'Next persona'});
 respond(held[0],'A result');respond(held[1],'B result');
 await vi.waitFor(()=>expect(runtime.snapshot().sessions[0].activeRunId).toBeUndefined());
 expect(runtime.snapshot().events.filter(e=>e.type==='completed')).toHaveLength(3);
 const children=bodies.filter(b=>b.messages[1].content.startsWith('Subtask:'));
 for(const child of children){expect(child.messages[0]).toEqual(bodies[0].messages[0]);expect(child.messages).toHaveLength(2);expect(child.messages[1].content).not.toContain('delegate without');const names=child.tools.map((t:any)=>t.function.name);expect(names).toContain('tool_introspect');expect(names).not.toContain('agent_spawn');expect(names).not.toContain('agent_collect');expect(names).not.toContain('mcp_install_npm');expect(names).not.toContain('files_read');}
 const last=bodies.at(-1);expect(last.messages.at(-1).content).toContain('A result');expect(last.messages.at(-1).content).toContain('B result');expect(last.messages[0]).toEqual(bodies[0].messages[0]);
 const count=bodies.length;await runtime.shutdown();const restored=new Runtime(path);await restored.init();await restored.shutdown();expect(bodies).toHaveLength(count);
 expect(restored.snapshot().events.filter(e=>e.parentRunId&&e.type==='completed')).toHaveLength(2);
});
it('routes child approvals by run/session, stops one waiting child, keeps sibling result and rejects stale approval',async()=>{
 const {runtime,sessionId}=await httpRuntime((body,res)=>{
  const child=body.messages[1].content.startsWith('Subtask:');const results=body.messages.filter((m:any)=>m.role==='tool');
  if(child){if(!results.length)respond(res,'',[{id:'same-call',name:'files_write',args:{path:body.messages[1].content.includes('first')?'a.txt':'b.txt',content:'child content'}}]);else respond(res,'child finished');return;}
  if(!results.length)respond(res,'',[{name:'agent_spawn',args:{title:'A',task:'first'}},{name:'agent_spawn',args:{title:'B',task:'second'}}]);else respond(res,'summary');
 });
 const workspace=await dir();await runtime.request({type:'workspace.grant',sessionId,path:workspace,confirmed:true});await runtime.request({type:'run.start',sessionId,prompt:'two writes'});
 await vi.waitFor(()=>expect(runtime.snapshot().events.filter(e=>e.type==='approval_requested')).toHaveLength(2));
 await expect(runtime.request({type:'session.archive',sessionId})).rejects.toThrow();
 const approvals=runtime.snapshot().events.filter(e=>e.type==='approval_requested'),a=approvals.find(e=>(e.data.args as any).path==='a.txt')!,b=approvals.find(e=>e!==a)!;
 const other=(await runtime.request({type:'session.create'})).sessionId!;
 await expect(runtime.request({type:'run.approve',sessionId:other,runId:a.runId,callId:'same-call',allowed:true})).rejects.toThrow();
 await runtime.request({type:'run.cancel',sessionId,runId:a.runId});
 await vi.waitFor(()=>expect(runtime.snapshot().events.some(e=>e.runId===a.runId&&e.type==='cancelled')).toBe(true));
 await expect(runtime.request({type:'run.approve',sessionId,runId:a.runId,callId:'same-call',allowed:true})).rejects.toThrow();
 await runtime.request({type:'run.approve',sessionId,runId:b.runId,callId:'same-call',allowed:true});
 await vi.waitFor(()=>expect(runtime.snapshot().sessions.find(s=>s.id===sessionId)?.activeRunId).toBeUndefined());
 await expect(readFile(join(workspace,'a.txt'))).rejects.toThrow();expect(await readFile(join(workspace,'b.txt'),'utf8')).toBe('child content');
 expect(runtime.snapshot().events.some(e=>e.runId===b.runId&&e.type==='completed')).toBe(true);
});
it('parent cancellation aborts in-flight model and questionnaire waits, no late result or replay',async()=>{
 let held:ServerResponse|undefined;
 const {runtime,sessionId,path}=await httpRuntime((body,res)=>{
  const prompt=body.messages[1].content;
  if(prompt.startsWith('Subtask: wait')){held=res;return;}
  if(prompt.startsWith('Subtask: ask')){respond(res,'',[{name:'ask_user',args:{title:'Details',questions:[{id:'q',title:'Which?',type:'text',required:true}]}}]);return;}
  if(body.messages.some((m:any)=>m.role==='tool'))respond(res,'parent done');else respond(res,'',[{name:'agent_spawn',args:{title:'Wait',task:'wait'}},{name:'agent_spawn',args:{title:'Ask',task:'ask'}}]);
 });
 await runtime.request({type:'run.start',sessionId,prompt:'start'});
 await vi.waitFor(()=>{expect(held).toBeDefined();expect(runtime.snapshot().events.some(e=>e.type==='question_requested')).toBe(true);});
 const parent=runtime.snapshot().sessions[0].activeRunId!,q=runtime.snapshot().events.find(e=>e.type==='question_requested')!;
 await runtime.request({type:'run.cancel',sessionId,runId:parent});
 await vi.waitFor(()=>expect(runtime.snapshot().sessions[0].activeRunId).toBeUndefined());
 expect(runtime.snapshot().events.filter(e=>e.type==='cancelled')).toHaveLength(3);
 await expect(runtime.request({type:'run.answer',sessionId,runId:q.runId,ticket:q.data.ticket,response:{status:'cancelled'}})).rejects.toThrow();
 respond(held!,'late response');await new Promise(r=>setTimeout(r,30));expect(runtime.snapshot().events.some(e=>e.type==='completed')).toBe(false);
 await runtime.shutdown();const fresh=new Runtime(path);await fresh.init();expect(fresh.snapshot().events.filter(e=>e.type==='cancelled')).toHaveLength(3);await fresh.shutdown();
});
async function family(provider:GenerationProvider,base:Tool[]=[]){const events:RunEvent[]=[],log=new EventLog(join(await dir(),'log'));const f=new Subagents(()=>provider,base,log,e=>events.push(e),'11111111-1111-4111-8111-111111111111',s=>s,0);const controller=new AbortController();f.start('22222222-2222-4222-8222-222222222222',controller.signal);cleanup.push(()=>f.close());return {f,events,signal:controller.signal};}
it('enforces concurrency, total cap, strict IDs and failures remain isolated',async()=>{
 const releases:(()=>void)[]=[];const {f,events,signal}=await family({generate:async()=>{await new Promise<void>(r=>releases.push(r));return {text:'ok'};}});
 const spawn=f.tools()[0],collect=f.tools()[1],ids:string[]=[];
 for(let i=0;i<3;i++)ids.push(JSON.parse(await spawn.execute({title:String(i),task:'task'},signal)).taskId);
 await expect(spawn.execute({title:'four',task:'task'},signal)).rejects.toThrow('concurrency');
 await expect(collect.execute({taskIds:['unknown']},signal)).rejects.toThrow('Unknown');
 await expect(collect.execute({taskIds:[ids[0],ids[0]]},signal)).rejects.toThrow('Invalid');
 await vi.waitFor(()=>expect(releases).toHaveLength(3));releases.splice(0).forEach(r=>r());
 expect(JSON.parse(await collect.execute({taskIds:ids},signal)).every((t:any)=>t.status==='completed')).toBe(true);
 for(let i=0;i<3;i++)ids.push(JSON.parse(await spawn.execute({title:'next',task:'task'},signal)).taskId);
 await expect(spawn.execute({title:'seven',task:'task'},signal)).rejects.toThrow('at most 6');
 await f.close();expect(events.filter(e=>e.type==='cancelled')).toHaveLength(3);
});
it('child recursion is unknown, actual introspection omits orchestration and child failure does not poison collection',async()=>{
 const provider:GenerationProvider={generate:async(messages)=>{
  if(messages[0].text.includes('fail'))throw new Error('fixture failure');
  if(messages.length===1)return {text:'',calls:[{id:'inspect',name:'tool_introspect',args:{}},{id:'recurse',name:'agent_spawn',args:{title:'forbidden',task:'no'}}]};
  return {text:'finished without recursion'};
 }};
 const {f,events,signal}=await family(provider),ids=[];
 for(const task of ['normal','fail'])ids.push(JSON.parse(await f.tools()[0].execute({title:task,task},signal)).taskId);
 const reports=JSON.parse(await f.tools()[1].execute({taskIds:ids},signal));expect(reports.map((r:any)=>r.status)).toEqual(['completed','failed']);
 const inspected=events.find(e=>e.type==='tool_result'&&e.data.name==='tool_introspect')!;expect(JSON.parse(String(inspected.data.text)).map((t:any)=>t.name)).toEqual(['tool_introspect']);
 expect(events.find(e=>e.type==='tool_result'&&e.data.name==='agent_spawn')?.data.isError).toBe(true);
});
it('rejects stale write approvals and racing writes including creating the same new file',async()=>{
 const root=await dir(),priv=await dir(),files=await WorkspaceFiles.grant(root,priv),tool=files.tools().find(t=>t.name==='files_write')!,signal=new AbortController().signal;
 const a=await tool.prepare!({path:'same.txt',content:'A'},signal),b=await tool.prepare!({path:'same.txt',content:'B'},signal);
 const outcomes=await Promise.allSettled([a.execute(signal),b.execute(signal)]);expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await readFile(join(root,'same.txt'),'utf8')).toBe('A');
 const stale=await tool.prepare!({path:'same.txt',content:'stale'},signal);await writeFile(join(root,'same.txt'),'external update');await expect(stale.execute(signal)).rejects.toThrow('改变');expect(await readFile(join(root,'same.txt'),'utf8')).toBe('external update');
});
it('child step budget is bounded and reports failure instead of hanging forever',async()=>{
 let count=0;const {f,signal}=await family({generate:async()=>({text:'',calls:[{id:String(++count),name:'tool_introspect',args:{}}]})});
 const id=JSON.parse(await f.tools()[0].execute({title:'loop',task:'loop'},signal)).taskId;
 const result=JSON.parse(await f.tools()[1].execute({taskIds:[id]},signal));expect(count).toBe(6);expect(result[0].status).toBe('failed');expect(result[0].result).toContain('budget');
});
it('parent budget exhaustion cancels all pending children before releasing the run',async()=>{
 const root=await dir(),events:RunEvent[]=[],log=new EventLog(join(root,'events'));
 const family=new Subagents(()=>({generate:()=>new Promise(()=>{})}),[],log,e=>events.push(e),'11111111-1111-4111-8111-111111111111',s=>s,0);
 const parent=new Agent({generate:async()=>({text:'',calls:[{id:'spawn',name:'agent_spawn',args:{title:'wait',task:'wait'}}]})},()=>family.tools(),log,e=>events.push(e),undefined,undefined,0,undefined,family);
 await parent.run('start',1);expect(parent.activeRunId).toBeUndefined();expect(events.filter(e=>e.type==='failed')).toHaveLength(1);expect(events.filter(e=>e.parentRunId&&e.type==='cancelled')).toHaveLength(1);
});
it('restart marks interrupted children with their original parent identity and does not replay',async()=>{
 const path=await dir(),runtime=new Runtime(path);await runtime.init();const sessionId=(await runtime.request({type:'session.create'})).sessionId!;await runtime.shutdown();
 const parentRunId='22222222-2222-4222-8222-222222222222',runId='33333333-3333-4333-8333-333333333333';
 await new EventLog(join(path,'sessions',`${sessionId}.jsonl`)).append({version:1,id:'44444444-4444-4444-8444-444444444444',runId,parentRunId,taskTitle:'Interrupted child',sessionId,at:'',type:'started',data:{prompt:'never replay'}});
 const fresh=new Runtime(path);await fresh.init();const terminal=fresh.snapshot().events.find(e=>e.type==='failed')!;expect(terminal.parentRunId).toBe(parentRunId);expect(terminal.taskTitle).toBe('Interrupted child');expect(terminal.data.reason).toContain('没有重放');await fresh.shutdown();
});
it('child answers continue the child model without authorizing any tool or crossing tickets',async()=>{
 const {f,events,signal}=await family({generate:async messages=>messages.some(m=>m.role==='tool')?{text:'child response after answer'}:{text:'',calls:[{id:'question',name:'ask_user',args:{title:'Details',questions:[{id:'q',title:'Which?',type:'text',required:true}]}}]}},[
  {name:'ask_user',interaction:'questionnaire',requiresApproval:false,inputSchema:{},description:'question',execute:async()=>{throw new Error('not executable')}}]);
 const id=JSON.parse(await f.tools()[0].execute({title:'question',task:'ask'},signal)).taskId;
 await vi.waitFor(()=>expect(events.some(e=>e.type==='question_requested')).toBe(true));const event=events.find(e=>e.type==='question_requested')!;
 expect(()=>f.find(id)!.answer('wrong',String(event.data.ticket),{status:'cancelled'})).toThrow();
 f.find(id)!.answer(id,String(event.data.ticket),{status:'answered',answers:[{questionId:'q',optionIds:[],text:'yes'}]});
 const result=JSON.parse(await f.tools()[1].execute({taskIds:[id]},signal));expect(result[0].status).toBe('completed');expect(result[0].result).toContain('after answer');expect(events.some(e=>e.type==='approval_resolved')).toBe(false);
});
it('serializes opaque MCP calls across the family and never starts a cancelled queued call',async()=>{
 const {f,signal}=await family({generate:async()=>({text:'done'})});let release!:()=>void;const execution=vi.fn(async()=>{await new Promise<void>(r=>release=r);return 'done';});
 const [tool]=f.guard([{name:'mcp_example',source:{serviceId:'s',serviceName:'Example',toolName:'write'},description:'opaque',inputSchema:{},requiresApproval:true,execute:execution}]);
 const a=tool.execute({},signal);await vi.waitFor(()=>expect(execution).toHaveBeenCalledTimes(1));
 const controller=new AbortController(),b=tool.execute({},controller.signal);const rejected=expect(b).rejects.toThrow();controller.abort();await rejected;release();await a;
 await new Promise(r=>setTimeout(r,10));expect(execution).toHaveBeenCalledTimes(1);expect(tool.requiresApproval).toBe(true);
});
