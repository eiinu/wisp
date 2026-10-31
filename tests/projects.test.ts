import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Runtime } from '../apps/host/src/runtime.js';
const cleanup: (()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const f of cleanup.splice(0).reverse())await f();});
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'wisp-projects-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
 const directory=join(root,'private'),a=join(root,'A'),b=join(root,'B');await mkdir(a);await mkdir(b);
 const runtime=new Runtime(directory);await runtime.init();cleanup.push(()=>runtime.shutdown());
 await writeFile(join(a,'same.txt'),'A');await writeFile(join(b,'same.txt'),'B');
 const pa=(await runtime.request({type:'project.create',path:a,confirmed:true})).projectId!;
 const pb=(await runtime.request({type:'project.create',name:'Project B',path:b,confirmed:true})).projectId!;
 const sa=(await runtime.request({type:'session.create',projectId:pa})).sessionId!;
 const sb=(await runtime.request({type:'session.create',projectId:pb})).sessionId!;
 return {root,directory,a,b,runtime,pa,pb,sa,sb};
}
it('derives project scopes from Host records, persists metadata and leaves old sessions independent',async()=>{
 const {runtime,directory,pa,pb,sa,sb,a}=await setup();
 const ordinary=(await runtime.request({type:'session.create'})).sessionId!;
 await runtime.request({type:'project.rename',projectId:pa,name:'Renamed'});
 await runtime.request({type:'project.collapse',projectId:pa,collapsed:true});
 expect((await runtime.request({type:'files.read',sessionId:sa,path:'same.txt',projectId:pb,root:'/'})).file?.text).toBe('A');
 expect((await runtime.request({type:'files.read',sessionId:sb,path:'same.txt'})).file?.text).toBe('B');
 await expect(runtime.request({type:'session.create',projectId:randomUUID()})).rejects.toThrow('项目不存在');
 await expect(runtime.request({type:'session.create',projectId:pa,workspace:'/'})).rejects.toThrow('格式');
 await expect(runtime.request({type:'workspace.grant',sessionId:sa,path:'/',confirmed:true})).rejects.toThrow('继承');
 await expect(runtime.request({type:'workspace.revoke',sessionId:sa})).rejects.toThrow('继承');
 const restarted=new Runtime(directory);await restarted.init();cleanup.push(()=>restarted.shutdown());
 expect(restarted.snapshot().projects?.find(p=>p.id===pa)).toMatchObject({name:'Renamed',workspace:a,collapsed:true});
 expect(restarted.snapshot().sessions.find(s=>s.id===sa)).toMatchObject({projectId:pa,workspace:a});
 expect(restarted.snapshot().sessions.find(s=>s.id===ordinary)?.projectId).toBeUndefined();
 await expect(restarted.request({type:'files.list',sessionId:ordinary})).rejects.toThrow('授权');
 const saved=JSON.parse(await readFile(join(directory,'state.json'),'utf8'));
 expect(saved.sessions.find((s:any)=>s.id===sa).workspace).toBeUndefined();
 delete saved.projects; saved.sessions=saved.sessions.filter((s:any)=>!s.projectId);await writeFile(join(directory,'state.json'),JSON.stringify(saved));
 const legacy=new Runtime(directory);await legacy.init();expect(legacy.snapshot().projects).toEqual([]);expect(legacy.snapshot().sessions[0].id).toBe(ordinary);
});
it('keeps project writes approval-bound across concurrent sessions and directory replacement',async()=>{
 const {runtime,sa,sb,a,b}=await setup();
 await Promise.all([runtime.request({type:'files.write',sessionId:sa,path:'new.txt',content:'A'}),runtime.request({type:'files.write',sessionId:sb,path:'new.txt',content:'B'})]);
 await vi.waitFor(()=>expect(runtime.snapshot().events.filter(e=>e.type==='approval_requested')).toHaveLength(2));
 const pending=runtime.snapshot().events.filter(e=>e.type==='approval_requested'),ea=pending.find(e=>e.sessionId===sa)!,eb=pending.find(e=>e.sessionId===sb)!;
 await expect(readFile(join(a,'new.txt'))).rejects.toThrow();
 await expect(runtime.request({type:'run.approve',sessionId:sb,runId:ea.runId,callId:ea.data.id,allowed:true})).rejects.toThrow('匹配');
 await runtime.request({type:'run.approve',sessionId:sb,runId:eb.runId,callId:eb.data.id,allowed:false});
 await rename(a,a+'-moved');await mkdir(a); // A pending approval must not authorize a replacement directory.
 await runtime.request({type:'run.approve',sessionId:sa,runId:ea.runId,callId:ea.data.id,allowed:true});
 await vi.waitFor(()=>expect(runtime.snapshot().events.filter(e=>['completed','failed'].includes(e.type))).toHaveLength(2));
 await expect(readFile(join(a,'new.txt'))).rejects.toThrow();await expect(readFile(join(b,'new.txt'))).rejects.toThrow();
});
it('rejects missing/private roots, traversal and symlinks, including after restart',async()=>{
 const {runtime,directory,a,b,sa,pa}=await setup();
 await expect(runtime.request({type:'project.create',path:directory,confirmed:true})).rejects.toThrow('私有');
 await expect(runtime.request({type:'project.create',path:a})).rejects.toThrow('格式');
 await symlink(join(b,'same.txt'),join(a,'link.txt'));
 for(const path of ['../B/same.txt','link.txt','.secret'])await expect(runtime.request({type:'files.read',sessionId:sa,path})).rejects.toThrow();
 await rename(a,a+'-moved');await symlink(b,a);
 const restarted=new Runtime(directory);await restarted.init();cleanup.push(()=>restarted.shutdown());
 await expect(restarted.request({type:'files.read',sessionId:sa,path:'same.txt'})).rejects.toThrow('项目目录不可用');
 await expect(restarted.request({type:'session.create',projectId:pa})).rejects.toThrow('项目目录不可用');
});
it('approved project writes use the original scope and restore after restart',async()=>{
 const {runtime,directory,a,b,sa}=await setup();
 await runtime.request({type:'files.write',sessionId:sa,path:'approved.txt',content:'approved'});
 await vi.waitFor(()=>expect(runtime.snapshot().events.some(e=>e.type==='approval_requested')).toBe(true));
 const e=runtime.snapshot().events.find(e=>e.type==='approval_requested')!;
 await runtime.request({type:'run.approve',sessionId:sa,runId:e.runId,callId:e.data.id,allowed:true,root:b});
 await vi.waitFor(async()=>expect(await readFile(join(a,'approved.txt'),'utf8')).toBe('approved'));
 await expect(readFile(join(b,'approved.txt'))).rejects.toThrow();
 const restored=new Runtime(directory);await restored.init();cleanup.push(()=>restored.shutdown());
 expect((await restored.request({type:'files.read',sessionId:sa,path:'approved.txt'})).file?.text).toBe('approved');
});
it('does not advertise a session as idle until its final checkpoint has finished',async()=>{
 const {ConversationStore}=await import('../apps/host/src/conversation.js');
 const {runtime,sa}=await setup();await runtime.request({type:'model.save',config:{provider:'offline',model:'test',baseUrl:''}});
 let terminal=false,release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 const unsubscribe=runtime.subscribe(n=>{if(n.type==='event'&&n.event.type==='completed')terminal=true;});
 const original=ConversationStore.prototype.save;
 const spy=vi.spyOn(ConversationStore.prototype,'save').mockImplementation(async function(this: InstanceType<typeof ConversationStore>, ...args){if(terminal)await gate;return original.apply(this,args);});
 try {
  await runtime.request({type:'run.start',sessionId:sa,prompt:'hello'});
  await vi.waitFor(()=>expect(terminal).toBe(true));
  expect(runtime.snapshot().sessions.find(s=>s.id===sa)?.activeRunId).toBeTruthy();
  release();await vi.waitFor(()=>expect(runtime.snapshot().sessions.find(s=>s.id===sa)?.activeRunId).toBeUndefined());
  await expect(runtime.request({type:'run.start',sessionId:sa,prompt:'hello again'})).resolves.toEqual({});
  await vi.waitFor(()=>{expect(runtime.snapshot().events.filter(e=>e.type==='completed')).toHaveLength(2);expect(runtime.snapshot().sessions.find(s=>s.id===sa)?.activeRunId).toBeUndefined();});
  await runtime.store.save();
 }finally{release();spy.mockRestore();unsubscribe();}
});
it('archives without deleting history or scope, persists and restores within the original project',async()=>{
 const {runtime,directory,pa,sa,sb,a}=await setup();
 const other=(await runtime.request({type:'session.create',projectId:pa})).sessionId!;
 await runtime.request({type:'model.save',config:{provider:'offline',model:'test',baseUrl:''}});
 await runtime.request({type:'run.start',sessionId:sa,prompt:'hello'});
 await vi.waitFor(()=>{expect(runtime.snapshot().events.some(e=>e.type==='completed')).toBe(true);expect(runtime.snapshot().sessions.find(s=>s.id===sa)?.activeRunId).toBeUndefined();});
 const history=runtime.snapshot().events.filter(e=>e.sessionId===sa);
 await runtime.request({type:'session.select',sessionId:sa});
 await runtime.request({type:'session.archive',sessionId:sa});
 expect(runtime.snapshot().selectedId).toBe(other);
 const timestamp=runtime.snapshot().sessions.find(s=>s.id===sa)?.archivedAt;
 await runtime.request({type:'session.archive',sessionId:sa});expect(runtime.snapshot().sessions.find(s=>s.id===sa)?.archivedAt).toBe(timestamp);
 for(const type of ['session.select','run.start','files.read'])await expect(runtime.request({type,sessionId:sa,path:'same.txt',prompt:'hello'})).rejects.toThrow('归档');
 await expect(runtime.request({type:'session.restore',sessionId:sa,projectId:runtime.snapshot().sessions.find(s=>s.id===sb)?.projectId})).rejects.toThrow('格式');
 const restart=new Runtime(directory);await restart.init();cleanup.push(()=>restart.shutdown());
 expect(restart.snapshot().events.filter(e=>e.sessionId===sa)).toEqual(history);
 expect(restart.snapshot().sessions.find(s=>s.id===sa)).toMatchObject({archivedAt:timestamp,projectId:pa,workspace:a});
 await restart.request({type:'project.collapse',projectId:pa,collapsed:true});
 await restart.request({type:'session.restore',sessionId:sa});
 expect(restart.snapshot().sessions.find(s=>s.id===sa)?.archivedAt).toBeUndefined();
 expect(restart.snapshot().projects?.find(p=>p.id===pa)?.collapsed).toBe(false);
 expect((await restart.request({type:'files.read',sessionId:sa,path:'same.txt'})).file?.text).toBe('A');
 await restart.request({type:'session.select',sessionId:sb});await restart.request({type:'session.archive',sessionId:sb});
 expect(restart.snapshot().selectedId).toBeUndefined(); // no cross-project fallback
 const independent=(await restart.request({type:'session.create'})).sessionId!;
 await restart.request({type:'session.archive',sessionId:independent});expect(restart.snapshot().selectedId).toBeUndefined();
 await restart.request({type:'session.restore',sessionId:independent});expect(restart.snapshot().sessions.find(s=>s.id===independent)?.projectId).toBeUndefined();
});
it('refuses archive while waiting for write approval and restored writes still require approval',async()=>{
 const {runtime,sa,a}=await setup();
 await runtime.request({type:'session.archive',sessionId:sa});await runtime.request({type:'session.restore',sessionId:sa});
 await runtime.request({type:'files.write',sessionId:sa,path:'pending.txt',content:'secret test'});
 await vi.waitFor(()=>expect(runtime.snapshot().events.some(e=>e.type==='approval_requested')).toBe(true));
 await expect(runtime.request({type:'session.archive',sessionId:sa})).rejects.toThrow('执行');
 expect(runtime.snapshot().sessions.find(s=>s.id===sa)?.archivedAt).toBeUndefined();
 await expect(readFile(join(a,'pending.txt'))).rejects.toThrow();
 const event=runtime.snapshot().events.find(e=>e.type==='approval_requested')!;
 await runtime.request({type:'run.approve',sessionId:sa,runId:event.runId,callId:event.data.id,allowed:false});
 await vi.waitFor(()=>expect(runtime.snapshot().sessions.find(s=>s.id===sa)?.activeRunId).toBeUndefined());
 await runtime.request({type:'session.archive',sessionId:sa});expect(runtime.snapshot().sessions.find(s=>s.id===sa)?.archivedAt).toBeTruthy();
 await expect(readFile(join(a,'pending.txt'))).rejects.toThrow();
});
