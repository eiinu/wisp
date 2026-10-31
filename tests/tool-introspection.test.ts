import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Registry, type Tool, type ModelProvider, type RunEvent } from '../packages/core/src/index.js';
import { Agent } from '../apps/host/src/agent.js';
import { EventLog } from '../apps/host/src/log.js';
import { Runtime } from '../apps/host/src/runtime.js';
import { snapshotTools } from '../apps/host/src/tool-introspection.js';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function directory() { const dir = await mkdtemp(join(tmpdir(), 'wisp-introspection-')); cleanup.push(() => rm(dir, { recursive: true, force: true })); return dir; }
it('strictly accepts only an empty object and exposes four metadata fields, including itself', async () => {
  const snapshot = snapshotTools([]), tool = snapshot.tools[0], signal = new AbortController().signal;
  for (const args of [null, [], 'x', { extra: 1 }]) await expect(tool.execute(args as any, signal)).rejects.toThrow('空对象');
  const result = JSON.parse(await tool.execute({}, signal));
  expect(result).toHaveLength(1); expect(result[0].requiresApproval).toBe(false);
  expect(Object.keys(result[0]).sort()).toEqual(['description', 'inputSchema', 'name', 'requiresApproval']);
  expect(result.map(({requiresApproval, ...definition}: any) => definition)).toEqual(snapshot.definitions());
});
it('captures registry, nested schema and approval metadata once, isolates provider mutations and subsequent runs', async () => {
  const registry = new Registry<Tool>();
  const original: Tool = { name: 'fixture', description: 'original', inputSchema: {type:'object',properties:{nested:{type:'string'}}}, requiresApproval:true, execute:async()=>'' };
  registry.register(original.name, original);
  const observed: any[] = [], answers: any[] = [], events: RunEvent[] = [];
  const provider: ModelProvider = { listModels: async () => [], async *stream(input) {
    observed.push(structuredClone(input.tools));
    if (input.messages.at(-1)?.role === 'tool') {
      answers.push(JSON.parse(input.messages.at(-1)!.text));
      yield {type:'finish', reason:'stop', message:{role:'assistant',text:'done'}}; return;
    }
    original.description='changed'; original.requiresApproval=false;
    (original.inputSchema.properties as any).nested.type='number';
    if (!registry.values().some(t=>t.name==='added')) registry.register('added',{...original,name:'added'});
    input.tools[0].description='provider mutation'; (input.tools[0].inputSchema.properties as any).nested.type='boolean';
    yield {type:'finish',reason:'tool_calls',message:{role:'assistant',text:'',calls:[{id:'inspect',name:'tool_introspect',args:{}}]}};
  }};
  const agent = new Agent(provider,registry,new EventLog(join(await directory(),'log.jsonl')),e=>events.push(e));
  await agent.run('first'); await agent.run('second');
  for (let run=0;run<2;run++) {
    expect(answers[run].map(({requiresApproval,...definition}:any)=>definition)).toEqual(observed[run*2]);
    expect(observed[run*2+1]).toEqual(observed[run*2]);
  }
  expect(answers[0].map((t:any)=>t.name)).toEqual(['fixture','tool_introspect']);
  expect(answers[0][0].requiresApproval).toBe(true); expect(answers[1][0].requiresApproval).toBe(false);
  expect(answers[1].map((t:any)=>t.name)).toEqual(['fixture','added','tool_introspect']);
  expect(events.filter(e=>e.type==='approval_requested')).toEqual([]);
});
it('matches real adapter HTTP definitions with and without directory grants, without reading user data', async () => {
  const requests:any[]=[]; const results:any[]=[];
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);requests.push(input.tools);
    const current=input.messages.slice(input.messages.findLastIndex((m:any)=>m.role==='user'));
    const result=current.find((m:any)=>m.role==='tool');if(result)results.push(JSON.parse(result.content));
    res.writeHead(200,{'content-type':'text/event-stream'});
    const delta=result?{content:'done'}:{tool_calls:[{index:0,id:'inspect',type:'function',function:{name:'tool_introspect',arguments:'{}'}}]};
    res.end(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:result?'stop':'tool_calls'}]})}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));cleanup.push(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const runtime=new Runtime(await directory(),undefined,undefined,{baseUrl:`http://127.0.0.1:${(server.address() as any).port}`,key:'only-fake-key'});
  await runtime.init();cleanup.push(()=>runtime.shutdown());
  const id=(await runtime.request({type:'session.create'})).sessionId!;
  for(const grant of [false,true]) {
    if(grant)await runtime.request({type:'workspace.grant',sessionId:id,path:await directory(),confirmed:true});
    await runtime.request({type:'run.start',sessionId:id,prompt:'inspect'});
    await vi.waitFor(()=>{expect(runtime.snapshot().events.filter(e=>e.type==='completed')).toHaveLength(grant?2:1);expect(runtime.snapshot().sessions.find(s=>s.id===id)?.activeRunId).toBeUndefined();});
  }
  expect(results).toHaveLength(2);
  results.forEach((list,index)=>{
    expect(list.map(({requiresApproval,...t}:any)=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}}))).toEqual(requests[index*2]);
    expect(requests[index*2+1]).toEqual(requests[index*2]);
    expect(list.filter((t:any)=>t.name==='tool_introspect')).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain('only-fake-key');
  });
  expect(results[0].filter((t:any)=>t.name.startsWith('files_'))).toEqual([]);
  for(const name of ['files_list','files_read','files_write'])expect(results[1].some((t:any)=>t.name===name)).toBe(true);
  expect(runtime.snapshot().events.filter(e=>e.type==='approval_requested')).toEqual([]);
});
