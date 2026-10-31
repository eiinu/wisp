import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { McpSetup, checkLock, runSetup, type SetupRunner } from '../apps/host/src/mcp-setup.js';
import { LocalMcp } from '../apps/host/src/local-mcp.js';
const cleanup:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{vi.unstubAllEnvs();for(const fn of cleanup.splice(0).reverse())await fn();});
const signal=()=>new AbortController().signal;
const plan={name:'Fixture',package:'@fixture/server',version:'1.2.3',bin:'fixture',args:[]};
const lock=()=>({lockfileVersion:3,packages:{'':{},'node_modules/@fixture/server':{version:'1.2.3',resolved:'https://registry.npmjs.org/@fixture/server/-/server-1.2.3.tgz',integrity:'sha512-ZmFrZQ=='}}});
async function setup(runner?:SetupRunner){
 const dir=await mkdtemp(join(tmpdir(),'wisp-setup-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));const mcp=new LocalMcp(dir,()=>{});await mcp.init();cleanup.push(()=>mcp.shutdown());
 const calls:string[][]=[];
 const fake:SetupRunner=runner??(async(_cmd,args,cwd,signal)=>{signal.throwIfAborted();calls.push(args);if(args[0]==='--version')return '12.0.0';if(args[0]==='install')await writeFile(join(cwd,'package-lock.json'),JSON.stringify(lock()));if(args[0]==='ci'){
  const root=join(cwd,'node_modules/@fixture/server');await mkdir(root,{recursive:true});await writeFile(join(root,'package.json'),JSON.stringify({name:plan.package,version:plan.version,bin:{fixture:'index.mjs'}}));await writeFile(join(root,'index.mjs'),await readFile(resolve('scripts/fixtures/mcp-stdio.mjs')));
 }return '';});
 const binaries=async()=>({node:process.execPath,npm:'/mock/npm'}),manager=new McpSetup(dir,mcp,fake,binaries);
 return {dir,mcp,manager,calls,fake,binaries,tool:(name:string)=>manager.tools().find(t=>t.name===name)!};
}
it('installs only after approval preparation, registers disabled and reuses a durable completed install',async()=>{
 const f=await setup(),tool=f.tool('mcp_install_npm');const prepared=await tool.prepare!(plan,signal());expect(f.calls).toHaveLength(0);expect(f.mcp.snapshot()).toHaveLength(0);
 expect(prepared.description).toContain('registry.npmjs.org');expect(prepared.description).toContain('1.2.3');
 const result=JSON.parse(await prepared.execute(signal()));expect(result).toMatchObject({installed:true,state:'disabled',version:'1.2.3'});expect(f.calls.map(c=>c[0])).toEqual(['--version','install','ci']);
 for(const args of f.calls)expect(args).toEqual(expect.arrayContaining(['--ignore-scripts','--allow-git=none','--allow-remote=none','--allow-file=none','--allow-directory=none']));
 expect(f.mcp.snapshot()[0]!.tools).toEqual([]);expect(await readFile(join(f.dir,'mcp-servers.json'),'utf8')).not.toContain('secret');
 await expect(prepared.execute(signal())).rejects.toThrow('消费');
 const again=new McpSetup(f.dir,f.mcp,f.fake,f.binaries);await(await again.tools().find(t=>t.name==='mcp_install_npm')!.prepare!(plan,signal())).execute(signal());expect(f.calls).toHaveLength(3);expect(f.mcp.snapshot()).toHaveLength(1);
 const connect=await f.tool('mcp_activate_service').prepare!({id:result.id},signal());const active=JSON.parse(await connect.execute(signal()));expect(active.state).toBe('connected');expect(active.tools).toHaveLength(1);
});
it('rejects unknown fields, non-exact package identities, URL and argument injection before any process',async()=>{
 const f=await setup();for(const invalid of [{...plan,package:'https://evil/package.tgz'},{...plan,package:'--registry=evil'},{...plan,version:'latest'},{...plan,version:'^1.2.3'},{...plan,bin:'../shell'},{...plan,env:{TOKEN:'fake-only'}},{...plan,args:['--token=fake-only']},{...plan,args:['--eval=bad']},{...plan,args:['x\0bad']}])await expect(f.tool('mcp_install_npm').prepare!(invalid,signal())).rejects.toThrow();expect(f.calls).toHaveLength(0);
 for(const command of ['/bin/sh','/bin/bash','/usr/bin/env'])await expect(f.tool('mcp_register').prepare!({name:'bad',command,args:[]},signal())).rejects.toThrow();
});
it('validates every lock dependency source, version, integrity and path',()=>{
 checkLock(lock(),plan.package,plan.version);
 for(const value of [{resolved:'https://evil.test/pkg'},{resolved:'https://registry.npmjs.org@evil.test/pkg'},{resolved:'file:/tmp/pkg'},{resolved:'https://registry.npmjs.org/pkg?token=secret'},{integrity:''},{link:true},{version:'2.0.0'}]){const l=lock();Object.assign(l.packages['node_modules/@fixture/server'],value);expect(()=>checkLock(l,plan.package,plan.version)).toThrow();}
 const l:any=lock();l.packages['node_modules/../../bad']=l.packages['node_modules/@fixture/server'];expect(()=>checkLock(l,plan.package,plan.version)).toThrow();
});
it('fails closed on missing/old npm, install failure, cancellation and concurrent operations',async()=>{
 const old=await setup(async()=> '11.0.0');await expect((await old.tool('mcp_install_npm').prepare!(plan,signal())).execute(signal())).rejects.toThrow('npm 12');expect(old.mcp.snapshot()).toHaveLength(0);
 const missing=new McpSetup(old.dir,old.mcp,old.fake,async()=>{throw new Error('missing runtime');});await expect((await missing.tools()[2]!.prepare!(plan,signal())).execute(signal())).rejects.toThrow('missing');
 let entered=false;const wait=await setup(async(_c,args,_d,s)=>{if(args[0]==='--version')return '12.0.0';entered=true;await new Promise<void>(resolve=>s.addEventListener('abort',()=>resolve(),{once:true}));s.throwIfAborted();return '';});
 const controller=new AbortController();const prepared=await wait.tool('mcp_install_npm').prepare!(plan,controller.signal);const task=prepared.execute(controller.signal),rejected=expect(task).rejects.toThrow();await vi.waitFor(()=>expect(entered).toBe(true));
 await expect((await wait.tool('mcp_install_npm').prepare!({...plan,name:'other'},signal())).execute(signal())).rejects.toThrow('正在执行');controller.abort();await rejected;expect(wait.mcp.snapshot()).toHaveLength(0);
 await expect((await wait.tool('mcp_install_npm').prepare!(plan,signal())).execute(signal())).rejects.toThrow('已有安装尝试');
});
it('registers existing executables once and invalidates activation after hidden environment replacement',async()=>{
 const f=await setup();const config={name:'Existing',command:process.execPath,args:[resolve('scripts/fixtures/mcp-stdio.mjs')]};
 const result=JSON.parse(await(await f.tool('mcp_register').prepare!(config,signal())).execute(signal()));expect(result.installed).toBe(false);
 expect(JSON.parse(await(await f.tool('mcp_register').prepare!(config,signal())).execute(signal())).alreadyConfigured).toBe(true);
 await f.mcp.save(result.id,{...config,command:await realpath(process.execPath)},{FAKE:'test-only'},false);
 const approval=await f.tool('mcp_activate_service').prepare!({id:result.id},signal());
 for(const detail of [config.name,await realpath(process.execPath),JSON.stringify(config.args),'目录：用户主目录','环境变量名称：FAKE','不受项目目录沙箱约束'])expect(approval.description).toContain(detail);
 expect(approval.description).not.toContain('test-only');
 await f.mcp.save(result.id,{...config,command:await realpath(process.execPath)},{FAKE:'changed-private'},false);
 await expect(approval.execute(signal())).rejects.toThrow('配置已变化');expect(f.mcp.snapshot()[0]?.state).toBe('disabled');
 expect(await f.tool('mcp_list_services').execute({},signal())).not.toContain('test-only');
});
it('restricted runner drops inherited secrets, reports errors without stderr, and terminates on cancellation/timeout',async()=>{
 const f=await setup();vi.stubEnv('WISP_FAKE_PRIVATE','not-inherited');
 expect(await runSetup(process.execPath,['-e','process.stdout.write(String(process.env.WISP_FAKE_PRIVATE))'],f.dir,signal())).toBe('undefined');
 await expect(runSetup(process.execPath,['-e','console.error("secret-stderr");process.exit(1)'],f.dir,signal())).rejects.toThrow('执行失败');
 await expect(runSetup('/missing/no-npm',[],f.dir,signal())).rejects.toThrow('找不到');
 await expect(runSetup(process.execPath,['-e','setInterval(()=>{},100)'],f.dir,AbortSignal.timeout(50))).rejects.toThrow('取消或超时');
});
it('drives installation and activation through real DeepSeek HTTP/Host approvals, then calls discovered stdio in a new run and resumes the model',async()=>{
 const {createServer}=await import('node:http');const {Runtime}=await import('../apps/host/src/runtime.js');
 const f=await setup();const received:any[]=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);received.push(input);
  const current=input.messages.slice(input.messages.findLastIndex((m:any)=>m.role==='user')),results=current.filter((m:any)=>m.role==='tool');
  let call:any;
  if(!results.some((m:any)=>String(m.content).includes('User denied')||String(m.content).includes('invalid_tool_request'))){
   if(current[0].content==='call activated fixture'&&results.length===0)call={name:input.tools.find((t:any)=>/^mcp_[a-f0-9]{32}_/.test(t.function.name)).function.name,args:{text:'setup-loop-fixture'}};
   else if(current[0].content==='call activated fixture'){}
   else if(results.length===0)call={name:'mcp_list_services',args:{}};
   else if(results.length===1)call={name:'mcp_install_npm',args:plan};
   else if(results.length===2)call={name:'mcp_activate_service',args:{id:JSON.parse(results[1].content).id}};
  }
  res.writeHead(200,{'content-type':'text/event-stream'});
  const delta=call?{tool_calls:[{index:0,id:`step-${results.length}`,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]}:{content:`fixture finished: ${results.at(-1)?.content??''}`};
  res.write(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:null}]})}\n\n`);
  res.end(`data: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:call?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));cleanup.push(()=>new Promise<void>(r=>server.close(()=>r())));
 const origin=`http://127.0.0.1:${(server.address() as any).port}`,hostdir=join(f.dir,'host');
 const runtime=new Runtime(hostdir,undefined,undefined,{baseUrl:origin,key:'fake-test-key'},undefined,{runner:f.fake,binaries:f.binaries});await runtime.init();cleanup.push(()=>runtime.shutdown());
 const id=(await runtime.request({type:'session.create'})).sessionId!;
 await runtime.request({type:'run.start',sessionId:id,prompt:'fixture setup'});
 const consumed=new Set<string>();
 for(const expected of ['mcp_install_npm','mcp_activate_service','third-party']){
  if(expected==='third-party'){await vi.waitFor(()=>expect(runtime.snapshot().sessions.find(s=>s.id===id)?.activeRunId).toBeUndefined(),{timeout:5000});await runtime.request({type:'run.start',sessionId:id,prompt:'call activated fixture'});}
  let pending:any;await vi.waitFor(()=>{pending=runtime.snapshot().events.findLast(e=>e.type==='approval_requested'&&!consumed.has(String(e.data.id))&&!runtime.snapshot().events.some(r=>r.type==='approval_resolved'&&r.runId===e.runId&&r.data.callId===e.data.id));expect(pending).toBeTruthy();},{timeout:5000});
  if(expected!=='third-party')expect(pending.data.name).toBe(expected);
  if(expected==='mcp_install_npm'){expect(f.calls).toHaveLength(0);expect(runtime.snapshot().mcpServers).toHaveLength(0);}
  if(expected==='mcp_activate_service'){expect(runtime.snapshot().mcpServers?.[0]?.state).toBe('disabled');expect(f.calls).toHaveLength(3);}
  consumed.add(String(pending.data.id));
  const approval={type:'run.approve' as const,sessionId:id,runId:pending.runId,callId:String(pending.data.id),allowed:true};await runtime.request(approval);await expect(runtime.request(approval)).rejects.toThrow();
 }
 await vi.waitFor(()=>expect(runtime.snapshot().events.filter(e=>e.type==='completed')).toHaveLength(2),{timeout:5000});
 expect(runtime.snapshot().events.findLast(e=>e.type==='assistant')?.data.text).toContain('setup-loop-fixture');expect(f.calls).toHaveLength(3);
 expect(JSON.stringify(runtime.snapshot())).not.toContain('fake-test-key');expect(received[0].tools.some((t:any)=>t.function.name==='mcp_install_npm')).toBe(true);
 for(const cancel of [false,true]){
  const sessionId=(await runtime.request({type:'session.create'})).sessionId!;await runtime.request({type:'run.start',sessionId,prompt:'fixture setup'});
  let pending:any;await vi.waitFor(()=>{pending=runtime.snapshot().events.find(e=>e.sessionId===sessionId&&e.type==='approval_requested');expect(pending).toBeTruthy();});
  if(cancel){await runtime.request({type:'run.cancel',sessionId,runId:pending.runId});await vi.waitFor(()=>expect(runtime.snapshot().sessions.find(s=>s.id===sessionId)?.activeRunId).toBeUndefined());await expect(runtime.request({type:'run.retry',sessionId})).rejects.toThrow('不能自动重放');}
  else{await runtime.request({type:'run.approve',sessionId,runId:pending.runId,callId:String(pending.data.id),allowed:false});await vi.waitFor(()=>expect(runtime.snapshot().events.some(e=>e.sessionId===sessionId&&e.type==='completed')).toBe(true));}
  expect(f.calls).toHaveLength(3);
 }
 await runtime.shutdown();const restarted=new Runtime(hostdir);await restarted.init();cleanup.push(()=>restarted.shutdown());expect(restarted.snapshot().mcpServers?.[0]?.state).toBe('disabled');expect(f.calls).toHaveLength(3);
});
it('rejects external dependencies before ci and leaves failed attempts unregistered',async()=>{
 let ci=0;const f=await setup(async(_c,args,cwd)=>{if(args[0]==='--version')return '12.0.0';if(args[0]==='install'){const l=lock();l.packages['node_modules/@fixture/server'].resolved='https://not-registry.invalid/a.tgz';await writeFile(join(cwd,'package-lock.json'),JSON.stringify(l));}if(args[0]==='ci')ci++;return '';});
 await expect((await f.tool('mcp_install_npm').prepare!(plan,signal())).execute(signal())).rejects.toThrow('官方 registry');expect(ci).toBe(0);expect(f.mcp.snapshot()).toHaveLength(0);
});
it('waits for a cancelled runner to settle on shutdown and prevents further execution',async()=>{
 let entered=false,closed=false;
 const f=await setup(async(_c,args,_d,s)=>{if(args[0]==='--version')return '12.0.0';entered=true;await new Promise<void>(r=>s.addEventListener('abort',()=>r(),{once:true}));await new Promise(r=>setTimeout(r,20));closed=true;s.throwIfAborted();return '';});
 const prepared=await f.tool('mcp_install_npm').prepare!(plan,signal()),task=prepared.execute(signal()),rejected=expect(task).rejects.toThrow();await vi.waitFor(()=>expect(entered).toBe(true));await f.manager.shutdown();await rejected;expect(closed).toBe(true);expect(f.mcp.snapshot()).toHaveLength(0);
 await expect((await f.tool('mcp_install_npm').prepare!({...plan,name:'next'},signal())).execute(signal())).rejects.toThrow();
});
