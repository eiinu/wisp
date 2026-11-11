import {it,expect,vi,afterEach} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp,rm,mkdir,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {QIANFAN_MODEL} from '../packages/core/src/index.js';
import {Runtime} from '../apps/host/src/runtime.js';
const cleanup:(()=>Promise<unknown>)[]=[];afterEach(async()=>{for(const f of cleanup.splice(0).reverse())await f();});
const fake='FAKE_QIANFAN_KEY_ONLY',reasoning='QIANFAN_PRIVATE_THOUGHT';
async function setup(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'wisp-qianfan-')));cleanup.push(()=>rm(root,{recursive:true,force:true}));const work=join(root,'work'),data=join(root,'data');await mkdir(work);
 const requests:any[]=[];let hold=false,started=false;
 const server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);requests.push({url:req.url,key:req.headers.authorization,body});res.writeHead(200,{'content-type':'text/event-stream'});
  if(hold){started=true;res.write(': waiting\n\n');return;}
  const last=body.messages.at(-1),send=(delta:any,finish_reason:string|null=null)=>res.write(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason}]})}\n\n`);
  if(last.role==='tool'){send({content:`工具结果已收到 ${fake}`},'stop');}else{send({reasoning_content:reasoning});send({tool_calls:[{index:0,id:'write-fixture',type:'function',function:{name:'files_write',arguments:'{"path":"fixture.txt","content":'}}]});send({tool_calls:[{index:0,function:{arguments:'"fixture data"}'}}]},'tool_calls');}
  res.end(`data: ${JSON.stringify({choices:[],usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13}})}\n\ndata: [DONE]\n\n`);
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));cleanup.push(()=>{server.closeAllConnections();return new Promise<void>(r=>server.close(()=>r()));});
 const runtime=new Runtime(data);await runtime.init();cleanup.push(()=>runtime.shutdown());
 const config={provider:'qianfan' as const,model:QIANFAN_MODEL,baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v2`};
 await runtime.request({type:'model.save',config,apiKey:fake,rememberKey:false});const sessionId=(await runtime.request({type:'session.create'})).sessionId!;await runtime.request({type:'workspace.grant',sessionId,path:work,confirmed:true});
 return {root,work,data,runtime,config,sessionId,requests,hold:()=>{hold=true;},started:()=>started};
}
it('runs streamed tool execution through Host approval, preserves private continuation on restart and redacts credentials',async()=>{
 const f=await setup();expect((await f.runtime.request({type:'model.list'})).models?.[0].id).toBe(QIANFAN_MODEL);expect(f.requests).toHaveLength(0);
 await f.runtime.request({type:'run.start',sessionId:f.sessionId,prompt:'写入测试文件'});await vi.waitFor(()=>expect(f.runtime.snapshot().events.some(e=>e.type==='approval_requested')).toBe(true));
 await expect(readFile(join(f.work,'fixture.txt'))).rejects.toThrow();const pending=f.runtime.snapshot().events.find(e=>e.type==='approval_requested')!;
 await f.runtime.request({type:'run.approve',sessionId:f.sessionId,runId:pending.runId,callId:pending.data.id,allowed:true});
 await vi.waitFor(()=>{expect(f.runtime.snapshot().events.some(e=>e.type==='completed')).toBe(true);expect(f.runtime.snapshot().sessions[0].activeRunId).toBeUndefined();});
 expect(await readFile(join(f.work,'fixture.txt'),'utf8')).toBe('fixture data');expect(f.requests).toHaveLength(2);expect(f.requests[0]).toMatchObject({url:'/v2/chat/completions',key:`Bearer ${fake}`});
 const continued=f.requests[1].body.messages.find((m:any)=>m.role==='assistant'&&m.tool_calls);expect(continued.reasoning_content).toBe(reasoning);expect(f.requests[1].body.messages.at(-1)).toMatchObject({role:'tool',tool_call_id:'write-fixture'});
 expect(JSON.stringify(f.runtime.snapshot())).not.toContain(fake);expect(JSON.stringify(f.runtime.snapshot())).not.toContain(reasoning);expect(await readFile(join(f.data,'state.json'),'utf8')).not.toContain(fake);
 const privateText=await readFile(join(f.data,'private-conversations',`${f.sessionId}.json`),'utf8');expect(privateText).toContain(reasoning);expect(privateText).not.toContain(fake);
 await f.runtime.shutdown();const restarted=new Runtime(f.data);await restarted.init();cleanup.push(()=>restarted.shutdown());expect(restarted.snapshot().keyPresent).toBe(false);
 await restarted.request({type:'model.save',config:f.config,apiKey:fake,rememberKey:false});await restarted.request({type:'run.start',sessionId:f.sessionId,prompt:'再写一次'});
 await vi.waitFor(()=>expect(restarted.snapshot().events.filter(e=>e.type==='approval_requested')).toHaveLength(2));const approval=restarted.snapshot().events.findLast(e=>e.type==='approval_requested')!;await restarted.request({type:'run.approve',sessionId:f.sessionId,runId:approval.runId,callId:approval.data.id,allowed:false});
 await vi.waitFor(()=>expect(restarted.snapshot().sessions[0].activeRunId).toBeUndefined());expect(f.requests.at(-1).body.messages.at(-1).content).toBe('User denied this action. Do not retry.');
});
it('a denied tool never writes, and cancellation stops the HTTP stream without retry',async()=>{
 const f=await setup();await f.runtime.request({type:'run.start',sessionId:f.sessionId,prompt:'需要审批'});await vi.waitFor(()=>expect(f.runtime.snapshot().events.some(e=>e.type==='approval_requested')).toBe(true));const p=f.runtime.snapshot().events.find(e=>e.type==='approval_requested')!;
 await f.runtime.request({type:'run.approve',sessionId:f.sessionId,runId:p.runId,callId:p.data.id,allowed:false});await vi.waitFor(()=>expect(f.runtime.snapshot().sessions[0].activeRunId).toBeUndefined());await expect(readFile(join(f.work,'fixture.txt'))).rejects.toThrow();
 f.hold();await f.runtime.request({type:'run.start',sessionId:f.sessionId,prompt:'取消连接'});await vi.waitFor(()=>expect(f.started()).toBe(true));const active=f.runtime.snapshot().sessions[0].activeRunId!;
 const count=f.requests.length;await f.runtime.request({type:'run.cancel',sessionId:f.sessionId,runId:active});await vi.waitFor(()=>expect(f.runtime.snapshot().sessions[0].activeRunId).toBeUndefined());expect(f.requests).toHaveLength(count);expect(f.runtime.snapshot().events.some(e=>e.runId===active&&e.type==='cancelled')).toBe(true);
});
it('provider switching never restores or sends the saved DeepSeek key to Qianfan and rejects Qianfan persistence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wisp-qianfan-keys-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));const vault={available:async()=>true,load:vi.fn(async()=> 'FAKE_SAVED_DEEPSEEK'),save:vi.fn(async()=>{}),delete:vi.fn(async()=>{})};
 const runtime=new Runtime(root,undefined,vault);await runtime.init();cleanup.push(()=>runtime.shutdown());await runtime.request({type:'model.save',config:{provider:'deepseek',model:'deepseek-flash',baseUrl:'https://api.deepseek.com'}});expect(runtime.snapshot().keyPresent).toBe(true);
 const config={provider:'qianfan',model:QIANFAN_MODEL,baseUrl:'https://qianfan.baidubce.com/v2'};await runtime.request({type:'model.save',config});expect(runtime.snapshot().keyPresent).toBe(false);await expect(runtime.request({type:'model.list'})).rejects.toThrow('Key');
 await expect(runtime.request({type:'model.save',config,apiKey:fake,rememberKey:true})).rejects.toThrow('DeepSeek');expect(vault.save).not.toHaveBeenCalled();
 await runtime.request({type:'model.save',config,apiKey:fake,rememberKey:false});expect(runtime.snapshot().keyPresent).toBe(true);expect(runtime.snapshot().credential?.saved).toBe(false);expect(vault.save).not.toHaveBeenCalled();expect(JSON.stringify(runtime.snapshot())).not.toContain(fake);
});
