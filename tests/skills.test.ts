import {afterEach,it,expect} from 'vitest';
import {realpath,mkdtemp,mkdir,writeFile,readFile,rm,symlink,link} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SkillRegistry,parseSkill} from '../apps/host/src/skills.js';
const clean:string[]=[];
afterEach(async()=>{for(const p of clean.splice(0))await rm(p,{recursive:true,force:true});});
const document=(body='BODY_ONE')=>`---\nname: review-notes\ndescription: Review useful notes\nallowed-tools: files_write\ncompatibility: Needs a human\n---\n${body}`;
async function setup(){const root=await realpath(await mkdtemp(join(tmpdir(),'wisp-skills-')));clean.push(root);const dir=join(root,'private'),skill=join(root,'review-notes');await mkdir(dir);await mkdir(skill);await mkdir(join(skill,'references'));await writeFile(join(skill,'SKILL.md'),document());await writeFile(join(skill,'references/note.txt'),'REFERENCE_ONE');const registry=new SkillRegistry(dir);await registry.init();return {root,dir,skill,registry};}
const signal=()=>new AbortController().signal;
it('parses format, folded YAML and optional metadata; rejects duplicate keys, tags, aliases and invalid names',()=>{
 expect(parseSkill('---\nname: review-notes\ndescription: >\n  Multi line\n  description\nmetadata:\n  author: a\n---\nBody','review-notes').description).toContain('Multi line description');
 for(const text of ['no frontmatter',document().replace('review-notes','Bad_Name'),document().replace('review-notes','review--notes'),document().replace('description:','name: duplicate\ndescription:'),document().replace('Review useful notes','!unsafe xyz'),document().replace('Review useful notes','&a yes\nother: *a'),document().replace('Review useful notes','x'.repeat(1025))])expect(()=>parseSkill(text,'review-notes')).toThrow();
});
it('defaults disabled, persists metadata only, enables and removes without deleting files',async()=>{
 const {registry,dir,skill}=await setup();await registry.add(skill);const info=registry.info()[0];expect(info.enabled).toBe(false);expect(info.warnings.join()).toContain('不授予权限');expect(registry.capture().execution().tools).toEqual([]);
 await expect(registry.add(skill)).rejects.toThrow('已添加');await registry.enable(info.id,true);
 const next=new SkillRegistry(dir);await next.init();expect(next.info()[0]).toEqual({...info,enabled:true});expect(await readFile(join(dir,'skills.json'),'utf8')).not.toContain('BODY_ONE');
 await next.remove(info.id);const restored=new SkillRegistry(dir);await restored.init();expect(restored.info()).toEqual([]);expect(await readFile(join(skill,'SKILL.md'),'utf8')).toContain('BODY_ONE');
});
it('captures metadata, loads only requested bodies/resources with version binding, and keeps agent load state separate',async()=>{
 const {registry,skill}=await setup();await registry.add(skill);const id=registry.info()[0].id;await registry.enable(id,true);const snapshot=registry.capture(),a=snapshot.execution(),b=snapshot.execution();
 const events:any[]=[];const context=await a.initialize(signal(),async(type,data)=>{events.push({type,data});});await b.initialize(signal(),async()=>{});
 expect(context).toContain('Review useful notes');expect(context).not.toContain('BODY_ONE');expect(context).not.toContain('REFERENCE_ONE');
 const [load,resource]=a.tools;await expect(resource.execute({skillId:id,path:'references/note.txt'},signal())).rejects.toThrow('先 skill_load');
 expect(await load.execute({skillId:id},signal())).toContain('BODY_ONE');await load.execute({skillId:id},signal());expect(events).toHaveLength(1);expect(events[0].data.source).toBe(skill);
 expect(await resource.execute({skillId:id,path:'references/note.txt'},signal())).toContain('REFERENCE_ONE');await expect(b.tools[1].execute({skillId:id,path:'references/note.txt'},signal())).rejects.toThrow('先 skill_load');
 await writeFile(join(skill,'references/note.txt'),'REFERENCE_TWO');await expect(resource.execute({skillId:id,path:'references/note.txt'},signal())).rejects.toThrow('已改变');
 await registry.refresh(id);await expect(load.execute({skillId:id},signal())).rejects.toThrow('刷新');expect(await registry.capture().execution([id]).initialize(signal(),async()=>{})).toContain('BODY_ONE');
});
it('revokes old snapshots on disable/re-enable/remove and refuses changed body even before refresh',async()=>{
 const {registry,skill}=await setup();await registry.add(skill);const id=registry.info()[0].id;await registry.enable(id,true);const load=registry.capture().execution().tools[0];
 await writeFile(join(skill,'SKILL.md'),document('CHANGED'));await expect(load.execute({skillId:id},signal())).rejects.toThrow('已改变');await registry.refresh(id);
 const fresh=registry.capture().execution().tools[0];await registry.enable(id,false);await registry.enable(id,true);await expect(fresh.execute({skillId:id},signal())).rejects.toThrow('禁用');const final=registry.capture().execution().tools[0];await registry.remove(id);await expect(final.execute({skillId:id},signal())).rejects.toThrow('移除');
});
it('rejects root/private/symlink escape, hardlinks, hidden, scripts, binary, oversized and unknown resources',async()=>{
 const {registry,skill,root,dir}=await setup();await writeFile(join(root,'secret'),'OUTSIDE');await symlink(join(root,'secret'),join(skill,'escape.txt'));await link(join(root,'secret'),join(skill,'hard.txt'));await writeFile(join(skill,'binary'),Buffer.from([0,1,2]));await writeFile(join(skill,'large'),'a'.repeat(65537));await mkdir(join(skill,'scripts'));await writeFile(join(skill,'scripts/a.js'),'not executed');await writeFile(join(skill,'.secret'),'hidden');
 await expect(registry.add(root)).rejects.toThrow('私有');await expect(registry.add(dir)).rejects.toThrow('私有');await symlink(skill,join(root,'alias'));await expect(registry.add(join(root,'alias'))).rejects.toThrow('链接');
 await registry.add(skill);const id=registry.info()[0].id;await registry.enable(id,true);const run=registry.capture().execution();await run.tools[0].execute({skillId:id},signal());
 for(const path of ['../secret','/etc/passwd','references/../../secret','escape.txt','hard.txt','binary','large','.secret','scripts/a.js','absent'])await expect(run.tools[1].execute({skillId:id,path},signal())).rejects.toThrow();
 await expect(run.tools[0].execute({skillId:id,extra:true},signal())).rejects.toThrow();await expect(run.tools[0].execute({skillId:'other'},signal())).rejects.toThrow();
 const controller=new AbortController();controller.abort();await expect(run.tools[0].execute({skillId:id},controller.signal)).rejects.toThrow();
});
it('refresh errors disable a skill and recover via explicit refresh and enable; initial selection validates IDs',async()=>{
 const {registry,skill}=await setup();await registry.add(skill);const id=registry.info()[0].id;await registry.enable(id,true);expect(()=>registry.capture().execution(['other'])).toThrow();expect(()=>registry.capture().execution([id,id])).toThrow();
 await writeFile(join(skill,'SKILL.md'),'broken');await registry.refresh(id);expect(registry.info()[0].enabled).toBe(false);expect(registry.info()[0].error).toContain('frontmatter');await expect(registry.enable(id,true)).rejects.toThrow();
 await writeFile(join(skill,'SKILL.md'),document());await registry.refresh(id);expect(registry.info()[0].error).toBeUndefined();expect(registry.info()[0].enabled).toBe(false);
});
