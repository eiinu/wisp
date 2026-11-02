import {it,expect,afterEach,vi} from 'vitest';
import {mkdtemp,mkdir,rm,readFile,writeFile,symlink,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {crc32} from 'node:zlib';
import {PublicHttp,publicAddress,publicUrl} from '../apps/host/src/public-http.js';
import {readArchive,selectSkill} from '../apps/host/src/skill-archive.js';
import {SkillRegistry} from '../apps/host/src/skills.js';
import {SkillInstall} from '../apps/host/src/skill-install.js';
import {binaryIdentity,runHostProcess} from '../apps/host/src/host-process.js';
const clean:(()=>Promise<unknown>)[]=[];afterEach(async()=>{for(const f of clean.splice(0).reverse())await f();});
const signal=()=>new AbortController().signal;
// Minimal stored ZIP fixture with genuine headers/CRC, no executable external package.
export function zip(entries:{path:string;text:string;mode?:number}[]){let offset=0;const records:Buffer[]=[],central:Buffer[]=[];for(const e of entries){const name=Buffer.from(e.path),body=Buffer.from(e.text),h=Buffer.alloc(30),c=Buffer.alloc(46);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt32LE(crc32(body),14);h.writeUInt32LE(body.length,18);h.writeUInt32LE(body.length,22);h.writeUInt16LE(name.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(0x314,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc32(body),16);c.writeUInt32LE(body.length,20);c.writeUInt32LE(body.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(((e.mode??0x81a4)*65536)>>>0,38);c.writeUInt32LE(offset,42);records.push(h,name,body);central.push(c,name);offset+=h.length+name.length+body.length;}const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...records,cd,end]);}
const sample=()=>zip([{path:'review-notes/SKILL.md',text:'---\nname: review-notes\ndescription: Fixture skill\n---\nRead references/a.txt.'},{path:'review-notes/references/a.txt',text:'reference'},{path:'review-notes/scripts/run.js',text:'console.log("fixture")'}]);
async function setup(body=sample()) {const root=await mkdtemp(join(tmpdir(),'wisp-install-'));clean.push(()=>rm(root,{recursive:true,force:true}));const registry=new SkillRegistry(root);await registry.init();const transport=vi.fn(async()=>({status:200,headers:{'content-type':'application/zip'},body}));const http=new PublicHttp(async()=>[{address:'93.184.216.34',family:4}],transport);const runner=vi.fn(async(_spec:import('../apps/host/src/host-process.js').ProcessSpec,_signal:AbortSignal)=>({exitCode:0,signal:null,status:'exited' as const,output:'fixture',truncated:false}));const binary=await binaryIdentity(process.execPath);const service=new SkillInstall(root,registry,http,runner,async()=>[{name:'node' as const,available:true,version:'test',...binary}]);clean.push(()=>service.shutdown());const tools=service.tools('one');const prepare=(name:string,args:Record<string,unknown>)=>(name==='process_run_skill'?service.tools('one'):tools).find(t=>t.name===name)!.prepare!(args,signal());const run=async(name:string,args:Record<string,unknown>)=>JSON.parse(await(await prepare(name,args)).execute(signal()));return {root,registry,service,tools,prepare,run,runner,binary,transport};}
it('rejects private/reserved/mapped/mixed addresses and credential URLs, pins DNS and validates every redirect',async()=>{
 for(const ip of ['127.0.0.1','10.1.1.1','169.254.169.254','100.64.0.1','192.0.2.1','198.18.0.1','224.0.0.1','0.0.0.0','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1'])expect(publicAddress(ip),ip).toBe(false);
 expect(publicAddress('8.8.8.8')).toBe(true);for(const u of ['http://example.com','https://user:pass@example.com','file:///etc/passwd','https://localhost','https://example.com:8443','https://example.com/#x'])expect(()=>publicUrl(u)).toThrow();
 const transport=vi.fn(async(_url:URL,_address:string)=>({status:302,headers:{location:'https://private.example/'},body:Buffer.alloc(0)}));const dns=vi.fn(async(host:string)=>[{address:host==='private.example'?'10.0.0.1':'8.8.8.8',family:4}]);await expect(new PublicHttp(dns,transport).get('https://example.com',signal())).rejects.toThrow('私网');expect(transport).toHaveBeenCalledTimes(1);expect(transport.mock.calls[0][1]).toBe('8.8.8.8');
 await expect(new PublicHttp(async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}],transport).get('https://example.com',signal())).rejects.toThrow('混合');
});
it('limits content type, bytes, redirects, cancellation and strips URL query in output',async()=>{
 const http=new PublicHttp(async()=>[{address:'8.8.8.8',family:4}],async()=>({status:200,headers:{'content-type':'text/plain'},body:Buffer.from('safe')}));const r=await http.text('https://example.com/a?token=never-show',signal());expect(JSON.stringify(r)).not.toContain('never-show');expect(r.untrusted).toBe(true);
 const controller=new AbortController();controller.abort();await expect(http.text('https://example.com',controller.signal)).rejects.toThrow();
 await expect(new PublicHttp(async()=>[{address:'8.8.8.8',family:4}],async()=>({status:200,headers:{'content-type':'text/plain'},body:Buffer.alloc(300000)})).text('https://example.com',signal())).rejects.toThrow('大小');
 await expect(new PublicHttp(async()=>[{address:'8.8.8.8',family:4}],async()=>({status:302,headers:{location:'/again'},body:Buffer.alloc(0)})).get('https://example.com',signal())).rejects.toThrow('过多');
});
it('checks complete ZIP, CRC, traversal, duplicate case, links, missing SKILL, entry size and cancellation',async()=>{
 const files=await readArchive(sample(),signal());expect(files).toHaveLength(3);expect(selectSkill(files,'review-notes').meta.name).toBe('review-notes');
 for(const entries of [[{path:'../evil',text:'x'}],[{path:'x',text:'x',mode:0xa1ff}],[{path:'A',text:'a'},{path:'a',text:'b'}],[{path:'x',text:'a'.repeat(1024*1024+1)}]])await expect(readArchive(zip(entries),signal())).rejects.toThrow();
 const broken=zip([{path:'x',text:'aaa'}]);broken[31]^=1;await expect(readArchive(broken,signal())).rejects.toThrow('CRC');
 expect(()=>selectSkill(files,'missing')).toThrow('SKILL');const abort=new AbortController();abort.abort();await expect(readArchive(sample(),abort.signal)).rejects.toThrow();
});
it('stages no registration, installs complete disabled skill after approval once, preserves scope and rejects stale updates',async()=>{
 const s=await setup();const d=await s.run('http_download',{url:'https://example.com/skill.zip'});expect(s.registry.info()).toHaveLength(0);
 const inspected=await s.run('skill_inspect_package',{artifactId:d.artifactId,root:'review-notes'});expect(inspected.files).toHaveLength(3);
 const plan=await s.prepare('skill_install_package',{artifactId:d.artifactId,root:'review-notes'});expect(plan.description).toContain('scripts/run.js');expect(plan.description).toContain(d.sha256);expect(s.registry.info()).toHaveLength(0);
 const installed=JSON.parse(await plan.execute(signal()));const entry=s.registry.info()[0];expect(installed.status).toBe('installed_disabled');expect(entry.enabled).toBe(false);expect(await readFile(join(entry.source,'scripts/run.js'),'utf8')).toContain('fixture');await expect(plan.execute(signal())).rejects.toThrow('消费');
 const other=s.service.tools('other').find(t=>t.name==='skill_inspect_package')!;await expect((await other.prepare!({artifactId:d.artifactId},signal())).execute(signal())).rejects.toThrow('其他任务');
 const update=await s.prepare('skill_install_package',{artifactId:d.artifactId,root:'review-notes',replaceId:entry.id});await s.registry.enable(entry.id,true);await expect(update.execute(signal())).rejects.toThrow('变化');
 const restored=new SkillRegistry(s.root);await restored.init();expect(restored.info()[0].managed).toBe(true);
});
it('aborted install never registers, no overwrite or external uninstall, enable applies next snapshot, managed uninstall revokes',async()=>{
 const s=await setup(),d=await s.run('http_download',{url:'https://example.com/a.zip'}),p=await s.prepare('skill_install_package',{artifactId:d.artifactId,root:'review-notes'});const c=new AbortController();c.abort();await expect(p.execute(c.signal)).rejects.toThrow();expect(s.registry.info()).toHaveLength(0);
 await s.run('skill_install_package',{artifactId:d.artifactId,root:'review-notes'});const old=s.registry.capture(),entry=s.registry.info()[0];await s.registry.enable(entry.id,true);expect(old.hasSkills).toBe(false);expect(s.registry.capture().hasSkills).toBe(true);
 await expect(s.prepare('skill_install_package',{artifactId:d.artifactId,root:'review-notes'})).rejects.toThrow('同名');await s.run('skill_uninstall',{skillId:entry.id});expect(s.registry.info()).toHaveLength(0);await expect(access(entry.source)).rejects.toThrow();
});
it('host process defaults closed, binds exact executable/script/all resources and rejects stale permission or file changes',async()=>{
 const s=await setup(),d=await s.run('http_download',{url:'https://example.com/a.zip'});await s.run('skill_install_package',{artifactId:d.artifactId,root:'review-notes'});const entry=s.registry.info()[0];await s.registry.enable(entry.id,true);const args={skillId:entry.id,executable:s.binary.path,script:'scripts/run.js',argv:[]};
 await expect(s.prepare('process_run_skill',args)).rejects.toThrow('默认关闭');s.service.configure(true);
 const p=await s.prepare('process_run_skill',args);expect(p.description).toContain('console.log');expect(p.description).toContain(s.binary.hash);expect(p.description).toContain('不是沙箱');await writeFile(join(entry.source,'references/a.txt'),'changed');await expect(p.execute(signal())).rejects.toThrow('内容已改变');expect(s.runner).not.toHaveBeenCalled();
 const p2=await s.prepare('process_run_skill',args);s.service.configure(false);await expect(p2.execute(signal())).rejects.toThrow('改变');s.service.configure(true);
 const result=await s.run('process_run_skill',args);expect(result.exitCode).toBe(0);expect(s.runner).toHaveBeenCalledTimes(1);expect(s.runner.mock.calls[0][0].args[0]).toMatch(/skill-jobs/);
 await symlink('/etc/passwd',join(entry.source,'outside'));await expect(s.prepare('process_run_skill',args)).rejects.toThrow('链接');
});
it('real trusted fixture process gets clean env, no shell, bounded output, timeout and parent cancellation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wisp-process-'));clean.push(()=>rm(root,{recursive:true,force:true}));const script=join(root,'fixture.cjs');await writeFile(script,"console.log(JSON.stringify(process.env));console.log(process.argv.slice(2));");process.env.WISP_FIXTURE_SECRET='never-inherit';try{
 const result=await runHostProcess({executable:process.execPath,args:[script,'; touch not-executed'],cwd:root,timeoutMs:2000},signal());expect(result.output).not.toContain('WISP_FIXTURE_SECRET');expect(result.output).toContain('; touch not-executed');expect(result.exitCode).toBe(0);
 }finally{delete process.env.WISP_FIXTURE_SECRET;}
 await writeFile(script,"setInterval(()=>console.log('x'.repeat(8192)),1)");const limited=await runHostProcess({executable:process.execPath,args:[script],cwd:root,timeoutMs:2000},signal());expect(limited.status).toBe('output_limit');expect(Buffer.byteLength(limited.output)).toBeLessThanOrEqual(65536);
 await writeFile(script,'setInterval(()=>{},1000)');expect((await runHostProcess({executable:process.execPath,args:[script],cwd:root,timeoutMs:100},signal())).status).toBe('timeout');const c=new AbortController(),running=runHostProcess({executable:process.execPath,args:[script],cwd:root,timeoutMs:2000},c.signal);c.abort();expect((await running).status).toBe('cancelled');
});
it('real HTTP adapter drives staged download, inspection and approved installation; deny/cancel never installs and replay never executes',async()=>{
 const {createServer}=await import('node:http'),{Runtime}=await import('../apps/host/src/runtime.js');const root=await mkdtemp(join(tmpdir(),'wisp-install-loop-'));clean.push(()=>rm(root,{recursive:true,force:true}));
 const received:any[]=[];const server=createServer(async(req,res)=>{
  if(req.url==='/package.zip'){res.writeHead(200,{'content-type':'application/zip'});res.end(sample());return;}
  let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);received.push(input);const current=input.messages.slice(input.messages.findLastIndex((m:any)=>m.role==='user')),results=current.filter((m:any)=>m.role==='tool');let call:any;
  if(!results.some((r:any)=>/User denied|tool_execution_failed|invalid_tool_request/.test(r.content))){
   if(results.length===0)call={name:'http_download',args:{url:'https://fixture.example/package.zip?private=do-not-log'}};
   else if(results.length===1)call={name:'skill_inspect_package',args:{artifactId:JSON.parse(results[0].content).artifactId,root:'review-notes'}};
   else if(results.length===2)call={name:'skill_install_package',args:{artifactId:JSON.parse(results[0].content).artifactId,root:'review-notes'}};
  }
  res.writeHead(200,{'content-type':'text/event-stream'});const delta=call?{tool_calls:[{index:0,id:`step-${results.length}`,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]}:{content:`fixture done: ${results.at(-1)?.content}`};
  res.end(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:call?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));clean.push(()=>new Promise<void>(r=>server.close(()=>r())));const baseUrl=`http://127.0.0.1:${(server.address() as any).port}`;
 // DI transport only: local HTTP assets stand in for a vetted public HTTPS socket, never relax production SSRF.
 let downloads=0;const http=new PublicHttp(async()=>[{address:'8.8.8.8',family:4}],async(_url,_address,_family,s)=>{downloads++;const r=await fetch(baseUrl+'/package.zip',{signal:s});return {status:r.status,headers:{'content-type':r.headers.get('content-type')!},body:Buffer.from(await r.arrayBuffer())};});
 const runtime=new Runtime(root,undefined,undefined,{baseUrl,key:'fake-install-key'},undefined,undefined,{http});await runtime.init();clean.push(()=>runtime.shutdown());
 const start=async()=>{const id=(await runtime.request({type:'session.create'})).sessionId!;await runtime.request({type:'run.start',sessionId:id,prompt:'install fixture'});return id;};
 const pending=async(id:string,name:string)=>{let e:any;await vi.waitFor(()=>{e=runtime.snapshot().events.find(e=>e.sessionId===id&&e.type==='approval_requested'&&e.data.name===name);expect(e).toBeTruthy();},{timeout:5000});return e;};
 const answer=async(id:string,e:any,allowed:boolean)=>runtime.request({type:'run.approve',sessionId:id,runId:e.runId,callId:e.data.id,allowed});
 const id=await start(),first=await pending(id,'http_download');expect(downloads).toBe(0);expect(JSON.stringify(first)).not.toContain('do-not-log');
 const other=(await runtime.request({type:'session.create'})).sessionId!;await expect(answer(other,first,true)).rejects.toThrow();await answer(id,first,true);await expect(answer(id,first,true)).rejects.toThrow();
 const second=await pending(id,'skill_install_package');expect(runtime.snapshot().skills).toEqual([]);expect(second.data.description).toContain('scripts/run.js');await answer(id,second,true);
 await vi.waitFor(()=>expect(runtime.snapshot().sessions.find(s=>s.id===id)?.activeRunId).toBeUndefined(),{timeout:5000});expect(runtime.snapshot().skills?.[0].enabled).toBe(false);expect(runtime.snapshot().events.findLast(e=>e.type==='assistant')?.data.text).toContain('installed_disabled');
 expect(received[0].tools.find((t:any)=>t.function.name==='process_run_skill')).toBeTruthy();expect(JSON.stringify(runtime.snapshot())).not.toContain('fake-install-key');
 for(const cancel of [false,true]){const id=await start(),e=await pending(id,'http_download');if(cancel)await runtime.request({type:'run.cancel',sessionId:id,runId:e.runId});else await answer(id,e,false);await vi.waitFor(()=>expect(runtime.snapshot().sessions.find(s=>s.id===id)?.activeRunId).toBeUndefined());}
 expect(downloads).toBe(1);expect(runtime.snapshot().skills).toHaveLength(1);await runtime.request({type:'execution.configure',enabled:true,confirmed:true});await runtime.shutdown();
 const restored=new Runtime(root);await restored.init();clean.push(()=>restored.shutdown());expect(restored.snapshot().hostExecutionEnabled).toBe(false);expect(restored.snapshot().skills).toHaveLength(1);expect(downloads).toBe(1);
});
it('approval binds update contents and rolls back a failed registry commit, and limits hostile archive count',async()=>{
 const s=await setup(),d=await s.run('http_download',{url:'https://example.com/a.zip'});const persist=vi.spyOn(s.registry,'installManaged').mockRejectedValueOnce(new Error('fixture storage unavailable'));
 await expect(s.run('skill_install_package',{artifactId:d.artifactId,root:'review-notes'})).rejects.toThrow('storage');expect(s.registry.info()).toEqual([]);const {readdir}=await import('node:fs/promises');expect(await readdir(join(s.root,'managed-skills'))).toEqual([]);persist.mockRestore();
 await s.run('skill_install_package',{artifactId:d.artifactId,root:'review-notes'});const entry=s.registry.info()[0],p=await s.prepare('skill_install_package',{artifactId:d.artifactId,root:'review-notes',replaceId:entry.id});await writeFile(join(entry.source,'references/a.txt'),'new user edits');await expect(p.execute(signal())).rejects.toThrow('变化');expect(await readFile(join(entry.source,'references/a.txt'),'utf8')).toBe('new user edits');
 await expect(readArchive(zip(Array.from({length:201},(_,i)=>({path:`f${i}`,text:'x'}))),signal())).rejects.toThrow();
});
it('revoke cancels inflight approved process, rejects concurrent jobs, collects only bounded safe text artifacts',async()=>{
 const s=await setup(),d=await s.run('http_download',{url:'https://example.com/a.zip'});await s.run('skill_install_package',{artifactId:d.artifactId,root:'review-notes'});const entry=s.registry.info()[0];await s.registry.enable(entry.id,true);s.service.configure(true);const args={skillId:entry.id,executable:s.binary.path,script:'scripts/run.js',argv:[]};
 let entered=false;s.runner.mockImplementationOnce(async(spec,signal)=>{entered=true;await new Promise<void>(r=>signal.addEventListener('abort',()=>r(),{once:true}));return {exitCode:null as any,signal:null,status:'cancelled' as any,output:'cancelled',truncated:false};});
 const running=s.run('process_run_skill',args);await vi.waitFor(()=>expect(entered).toBe(true),{timeout:5000});await expect(s.run('process_run_skill',args)).rejects.toThrow('正在执行');s.service.revoke(entry.id);expect((await running).status).toBe('cancelled');
 s.runner.mockImplementationOnce(async(spec)=>{await mkdir(join(spec.cwd,'output'));await writeFile(join(spec.cwd,'output','report.md'),'fixture artifact');await symlink('/etc/passwd',join(spec.cwd,'output','escape.txt'));await writeFile(join(spec.cwd,'output','large.txt'),'x'.repeat(40000));return {exitCode:0,signal:null,status:'exited',output:'ok',truncated:false};});
 expect((await s.run('process_run_skill',args)).artifacts).toEqual([{name:'report.md',text:'fixture artifact'}]);
});
it('cancels ordinary process-tree descendants, and DNS cancellation prevents dispatch',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wisp-tree-'));clean.push(()=>rm(root,{recursive:true,force:true}));const script=join(root,'parent.cjs');await writeFile(script,"const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000);");
 const result=await runHostProcess({executable:process.execPath,args:[script],cwd:root,timeoutMs:200},signal());expect(result.status).toBe('timeout');const pid=Number(result.output.trim());expect(pid).toBeGreaterThan(0);
 await vi.waitFor(async()=>{try{const status=await readFile(`/proc/${pid}/stat`,'utf8');expect(status.split(' ')[2]).toBe('Z');}catch(e:any){if(e.code!=='ENOENT')throw e;} });
 const transport=vi.fn();const h=new PublicHttp(()=>new Promise(()=>{}),transport);await expect(h.get('https://example.com',AbortSignal.timeout(20))).rejects.toThrow();expect(transport).not.toHaveBeenCalled();
});
it('rejects competing same-name install approvals after one commits, and allows bounded source inspection without execution',async()=>{
 const s=await setup(),d=await s.run('http_download',{url:'https://example.com/a.zip'}),args={artifactId:d.artifactId,root:'review-notes'};
 const source=await s.run('skill_inspect_package',{...args,path:'scripts/run.js'});expect(source.content).toContain('console.log');expect(s.runner).not.toHaveBeenCalled();
 const a=await s.prepare('skill_install_package',args),b=await s.prepare('skill_install_package',args);await a.execute(signal());await expect(b.execute(signal())).rejects.toThrow('同名');expect(s.registry.info()).toHaveLength(1);
});
it('execution classifier preserves structured nonzero/timeout result and redacts known secrets before model continuation',async()=>{
 const {Agent}=await import('../apps/host/src/agent.js'),{Registry}=await import('../packages/core/src/index.js'),{EventLog}=await import('../apps/host/src/log.js');const s=await setup(),tools=new Registry<import('../packages/core/src/index.js').Tool>(),seen:string[]=[],events:any[]=[];
 const actual=s.tools.find(t=>t.name==='process_run_skill')!;for(const value of [{status:'exited',exitCode:1},{status:'timeout',exitCode:null},{status:'exited',exitCode:0,cleanupUnconfirmed:true}])expect(actual.resultFailed!(JSON.stringify(value))).toBe(true);
 tools.register('fixture_result',{name:'fixture_result',description:'trusted fixture',inputSchema:{type:'object'},requiresApproval:false,resultFailed:actual.resultFailed,execute:async()=>JSON.stringify({status:'timeout',exitCode:null,output:'known-fixture-secret'})});
 const agent=new Agent({listModels:async()=>[],async *stream(input){const result=input.messages.find(m=>m.role==='tool');if(result){seen.push(result.text);yield {type:'finish',reason:'stop',message:{role:'assistant',text:'done'}} as const;}else yield {type:'finish',reason:'tool_calls',message:{role:'assistant',text:'',calls:[{id:'one',name:'fixture_result',args:{}}]}} as const;}},tools,new EventLog(join(s.root,'events.jsonl')),e=>events.push(e),undefined,text=>text.replaceAll('known-fixture-secret','[REDACTED]'));
 await agent.run('fixture');expect(seen[0]).toContain('[REDACTED]');expect(seen[0]).not.toContain('known-fixture-secret');expect(events.find(e=>e.type==='tool_result').data.isError).toBe(true);
});
it('child executions keep approval/cancellation ownership and cannot turn skill material into permission',async()=>{
 const {Subagents}=await import('../apps/host/src/subagents.js'),{EventLog}=await import('../apps/host/src/log.js');const s=await setup(),d=await s.run('http_download',{url:'https://example.com/a.zip'});await s.run('skill_install_package',{artifactId:d.artifactId,root:'review-notes'});const entry=s.registry.info()[0];await s.registry.enable(entry.id,true);s.service.configure(true);
 const args={skillId:entry.id,executable:s.binary.path,script:'scripts/run.js',argv:[]},events:any[]=[];
 const family=new Subagents(()=>({listModels:async()=>[],async *stream(input){yield {type:'finish',reason:input.messages.at(-1)?.role==='tool'?'stop':'tool_calls',message:input.messages.at(-1)?.role==='tool'?{role:'assistant',text:'finished'}:{role:'assistant',text:'',calls:[{id:'same-call',name:'process_run_skill',args}]}} as any;}}),s.service.tools('parent',s.registry.capture()),new EventLog(join(s.root,'children.jsonl')),e=>events.push(e),'11111111-1111-4111-8111-111111111111',text=>text,0);
 const parent=new AbortController();family.start('22222222-2222-4222-8222-222222222222',parent.signal);clean.push(()=>family.close());
 const spawn=family.tools().find(t=>t.name==='agent_spawn')!;const one=JSON.parse(await spawn.execute({title:'one',task:'fixture'},parent.signal)),two=JSON.parse(await spawn.execute({title:'two',task:'fixture'},parent.signal));
 await vi.waitFor(()=>expect(events.filter(e=>e.type==='approval_requested'),JSON.stringify(events)).toHaveLength(2));expect(s.runner).not.toHaveBeenCalled();
 expect(events.filter(e=>e.type==='approval_requested').every(e=>e.parentRunId==='22222222-2222-4222-8222-222222222222'&&[one.taskId,two.taskId].includes(e.runId))).toBe(true);
 s.runner.mockImplementationOnce(async(_spec,signal)=>{await new Promise<void>(r=>signal.addEventListener('abort',()=>r(),{once:true}));return {status:'cancelled' as any,exitCode:null as any,signal:null,output:'',truncated:false};});
 expect(()=>family.find(one.taskId)!.approve(two.taskId,'same-call',true)).toThrow();family.find(one.taskId)!.approve(one.taskId,'same-call',true);family.find(two.taskId)!.approve(two.taskId,'same-call',false);
 await vi.waitFor(()=>expect(s.runner).toHaveBeenCalledTimes(1));parent.abort();await family.close();expect(events.some(e=>e.runId===one.taskId&&e.type==='cancelled')).toBe(true);expect(events.some(e=>e.runId===two.taskId&&e.type==='approval_resolved'&&!e.data.allowed)).toBe(true);
});

it('process execution uses the parent run skill snapshot, rejects newly enabled or refreshed versions and observes revocation',async()=>{
 const s=await setup();s.service.configure(true);const before=s.registry.capture(),d=await s.run('http_download',{url:'https://example.com/a.zip'});await s.run('skill_install_package',{artifactId:d.artifactId,root:'review-notes'});const entry=s.registry.info()[0];await s.registry.enable(entry.id,true);
 const args={skillId:entry.id,executable:s.binary.path,script:'scripts/run.js',argv:[]};
 const tool=(snapshot:ReturnType<SkillRegistry['capture']>)=>s.service.tools('parent',snapshot).find(t=>t.name==='process_run_skill')!;
 await expect(tool(before).prepare!(args,signal())).rejects.toThrow('本轮');
 const captured=s.registry.capture(),parent=tool(captured),child=tool(captured);
 const approved=await parent.prepare!(args,signal());await s.registry.refresh(entry.id);
 await expect(child.prepare!(args,signal())).rejects.toThrow('刷新');await expect(approved.execute(signal())).rejects.toThrow('改变');expect(s.runner).not.toHaveBeenCalled();
 const next=tool(s.registry.capture());await(await next.prepare!(args,signal())).execute(signal());expect(s.runner).toHaveBeenCalledTimes(1);
 await s.registry.enable(entry.id,false);await expect(next.prepare!(args,signal())).rejects.toThrow('禁用');await s.registry.enable(entry.id,true);await expect(next.prepare!(args,signal())).rejects.toThrow('刷新');
});
it('every identical script call requires a fresh single-use decision; host opt-in never approves and cancellation prevents execution',async()=>{
 const {Agent}=await import('../apps/host/src/agent.js'),{EventLog}=await import('../apps/host/src/log.js');
 const s=await setup(),d=await s.run('http_download',{url:'https://example.com/a.zip'});await s.run('skill_install_package',{artifactId:d.artifactId,root:'review-notes'});const entry=s.registry.info()[0];await s.registry.enable(entry.id,true);s.service.configure(true);
 const args={skillId:entry.id,executable:s.binary.path,script:'scripts/run.js',argv:[]},events:any[]=[],tools=s.service.tools('parent',s.registry.capture());expect(tools.find(t=>t.name==='process_run_skill')!.requiresApproval).toBe(true);
 const agent=new Agent({generate:async messages=>messages.some(m=>m.role==='tool')?{text:'done'}:{text:'',calls:['first','second','third'].map(id=>({id,name:'process_run_skill',args}))}},()=>tools,new EventLog(join(s.root,'per-call.jsonl')),e=>events.push(e));
 const running=agent.run('same script three times');
 const pending=async(n:number)=>{await vi.waitFor(()=>expect(events.filter(e=>e.type==='approval_requested')).toHaveLength(n));return events.filter(e=>e.type==='approval_requested')[n-1];};
 const first=await pending(1);expect(s.runner).not.toHaveBeenCalled();agent.approve(first.runId,'first',true);expect(()=>agent.approve(first.runId,'first',true)).toThrow('pending');
 const second=await pending(2);expect(s.runner).toHaveBeenCalledTimes(1);expect(()=>agent.approve(second.runId,'first',true)).toThrow('pending');agent.approve(second.runId,'second',false);
 const third=await pending(3);expect(s.runner).toHaveBeenCalledTimes(1);agent.cancel(third.runId);expect(()=>agent.approve(third.runId,'third',true)).toThrow('pending');await running;
 expect(s.runner).toHaveBeenCalledTimes(1);expect(events.some(e=>e.type==='tool_result'&&e.data.callId==='second'&&e.data.denied)).toBe(true);expect(events.at(-1).type).toBe('cancelled');
});
it('normalizes allowed-tools string arrays as inert metadata and still requires execution approval',async()=>{
 const {parseSkill}=await import('../apps/host/src/skills.js');
 const main='---\nname: review-notes\ndescription: Fixture\nallowed-tools: [read, write, bash]\n---\nFixture body';
 const parsed=parseSkill(main);expect(parsed.allowedTools).toBe('read write bash');expect(parsed.warnings.join(' ')).toContain('不授予权限');expect(parsed.warnings.join(' ')).toContain('兼容');
 expect(parseSkill(main.replace('[read, write, bash]','read write bash')).allowedTools).toBe('read write bash');
 for(const value of ['42','true','{read: true}','[read, 2]','[read, null]','[[read]]','[""]'])expect(()=>parseSkill(main.replace('[read, write, bash]',value))).toThrow('allowed-tools');
 const s=await setup(zip([{path:'SKILL.md',text:main},{path:'README.md',text:'readme'}])),d=await s.run('http_download',{url:'https://example.com/a.zip'});
 const inspected=await s.run('skill_inspect_package',{artifactId:d.artifactId,root:'',path:'SKILL.md'});expect(inspected.metadataValid).toBe(true);expect(inspected.content).toBe(main);
 const plan=await s.prepare('skill_install_package',{artifactId:d.artifactId,root:''});expect(s.registry.info()).toHaveLength(0);await plan.execute(signal());expect(s.registry.info()[0].enabled).toBe(false);expect(s.service.hostExecutionEnabled).toBe(false);expect(s.tools.find(t=>t.name==='process_run_skill')!.requiresApproval).toBe(true);
});
it('invalid skill metadata does not block bounded safe archive text review, but still blocks installation',async()=>{
 const main='---\nname: review-notes\ndescription: Fixture\nallowed-tools: {read: true}\n---\nFixture body';
 const s=await setup(zip([{path:'pkg/SKILL.md',text:main},{path:'pkg/README.md',text:'readme'},{path:'pkg/_meta.json',text:'{"version":"fixture"}'},{path:'pkg/binary.bin',text:'\0'},{path:'pkg/large.txt',text:'a'.repeat(65537)}])),d=await s.run('http_download',{url:'https://example.com/a.zip'});
 for(const [path,content] of [['SKILL.md',main],['README.md','readme'],['_meta.json','{"version":"fixture"}']]){const result=await s.run('skill_inspect_package',{artifactId:d.artifactId,root:'pkg',path});expect(result.content).toBe(content);expect(result.metadataValid).toBe(false);expect(result.metadataError).toContain('allowed-tools');expect(result.untrusted).toBe(true);}
 await expect(s.prepare('skill_install_package',{artifactId:d.artifactId,root:'pkg'})).rejects.toThrow('allowed-tools');expect(s.registry.info()).toHaveLength(0);
 for(const path of ['../README.md','binary.bin','large.txt'])await expect(s.run('skill_inspect_package',{artifactId:d.artifactId,root:'pkg',path})).rejects.toThrow();
 const other=s.service.tools('another').find(t=>t.name==='skill_inspect_package')!;await expect((await other.prepare!({artifactId:d.artifactId,root:'pkg',path:'README.md'},signal())).execute(signal())).rejects.toThrow('其他任务');
 const dangerous=await setup(zip([{path:'SKILL.md',text:main},{path:'README.md',text:'safe'},{path:'../escape',text:'bad'}])),bad=await dangerous.run('http_download',{url:'https://example.com/bad.zip'});await expect(dangerous.run('skill_inspect_package',{artifactId:bad.artifactId,root:'',path:'README.md'})).rejects.toThrow(/ZIP/);
});
