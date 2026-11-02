import {it,expect,vi} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Runtime} from '../apps/host/src/runtime.js';
it('real HTTP adapter lists, directly refreshes authorized file and resumes with status only',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wisp-action-')),workspace=await mkdtemp(join(tmpdir(),'wisp-action-files-'));await writeFile(join(workspace,'note.txt'),'private fixture');
 const requests:any[]=[],outputs:any[]=[];;
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);requests.push(input);
  const turn=input.messages.slice(input.messages.findLastIndex((m:any)=>m.role==='user')),results=turn.filter((m:any)=>m.role==='tool');
  let delta:any,finish='tool_calls';
  if(!results.length)delta={tool_calls:[{index:0,id:'list',type:'function',function:{name:'list_preview_tabs',arguments:'{}'}}]};
  else if(results.length===1)delta={tool_calls:[{index:0,id:'refresh',type:'function',function:{name:'preview_tab_action',arguments:JSON.stringify({tabId:JSON.parse(results[0].content).tabs[0].tabId,action:'reload'})}}]};
  else {outputs.push(results[1].content);delta={content:'finished'};finish='stop';}
  res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:finish}]})}\n\ndata: [DONE]\n\n`);
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const runtime=new Runtime(dir,undefined,undefined,{baseUrl:`http://127.0.0.1:${(server.address() as any).port}`,key:'fake-test'});
 try{
  await runtime.init();const sessionId=(await runtime.request({type:'session.create'})).sessionId!;await runtime.request({type:'workspace.grant',sessionId,path:workspace,confirmed:true});let applications=0;
  const tasks:Promise<unknown>[]=[];runtime.subscribe(n=>{
   if(n.type==='preview.tabs')tasks.push((async()=>{await runtime.request({type:'preview.tabs.claim',sessionId,ticket:n.ticket});await runtime.request({type:'preview.tabs.complete',sessionId,ticket:n.ticket,tabs:[{id:'file',kind:'file',path:'note.txt',title:'Note',active:false,revision:1}]});})());
   if(n.type==='preview.action')tasks.push((async()=>{const claim=await runtime.request({type:'preview.action.claim',sessionId,ticket:n.ticket});expect(claim.tabAction?.action).toBe('reload');const result=await runtime.request({type:'preview.action.execute',sessionId,ticket:n.ticket});expect(result.file?.text).toBe('private fixture');applications++;await runtime.request({type:'preview.action.complete',sessionId,ticket:n.ticket,applied:true});})());
  });
  for(let run=1;run<=2;run++){await runtime.request({type:'run.start',sessionId,prompt:'refresh'});await vi.waitFor(()=>expect(runtime.snapshot().events.filter(e=>e.type==='completed')).toHaveLength(run));await Promise.all(tasks);}
  expect(applications).toBe(2);for(const output of outputs)expect(JSON.parse(output)).toMatchObject({status:'refreshed',contentRead:false});expect(JSON.stringify(outputs)).not.toContain('private fixture');
  expect(requests[0].tools.some((t:any)=>t.function.name==='preview_tab_action')).toBe(true);expect(runtime.snapshot().events.filter(e=>e.type==='approval_requested'||e.type==='approval_resolved')).toHaveLength(0);
 }finally{await runtime.shutdown();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});await rm(workspace,{recursive:true,force:true});}
});
