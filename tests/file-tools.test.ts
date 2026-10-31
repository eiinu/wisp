import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {WorkspaceFiles} from '../apps/host/src/files.js';
async function setup(){const root=await mkdtemp(join(tmpdir(),'wisp-tools-'));const work=join(root,'work'),privateDir=join(root,'private');await mkdir(work);await mkdir(privateDir);return {root,work,files:await WorkspaceFiles.grant(work,privateDir)};}
it('bounded literal search excludes private, hidden, links, binaries and dependency directories',async()=>{
 const {root,work,files}=await setup();try{
 await writeFile(join(work,'note.txt'),'hello\nNeedle example\n');await writeFile(join(work,'binary'),Buffer.from([0,78,101,101,100,108,101]));await writeFile(join(work,'.secret'),'Needle');await mkdir(join(work,'node_modules'));await writeFile(join(work,'node_modules','dep'),'Needle');await symlink(join(work,'note.txt'),join(work,'alias'));
 const tool=files.tools().find(t=>t.name==='files_search')!;const a={path:'',query:'Needle',mode:'content'};await tool.validate!(a);const result=JSON.parse(await tool.execute(a,new AbortController().signal));expect(result.matches).toEqual([{path:'note.txt',line:2,snippet:'Needle example'}]);expect(result.skipped).toBeGreaterThan(0);
 await expect(tool.validate!({...a,path:'../'})).rejects.toThrow();await expect(tool.validate!({...a,root:'/'})).rejects.toThrow();const aborted=AbortSignal.abort();await expect(tool.execute(a,aborted)).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
});
it('replacement binds approved content and file identity, preserves UTF-8 BOM and refuses stale/ambiguous edits',async()=>{
 const {root,work,files}=await setup();try{
 const path=join(work,'note.txt');await writeFile(path,'\ufeffone\ntwo\n');const tool=files.tools().find(t=>t.name==='files_replace')!;const a={path:'note.txt',oldText:'two',newText:'three'};await tool.validate!(a);const prepared=await tool.prepare!(a,new AbortController().signal);expect(prepared.description).toContain('--- 原内容\ntwo\n+++ 新内容\nthree');await prepared.execute(new AbortController().signal);expect(await readFile(path,'utf8')).toBe('\ufeffone\nthree\n');
 const stale=await tool.prepare!({...a,oldText:'three'},new AbortController().signal);await writeFile(path,'someone changed it');await expect(stale.execute(new AbortController().signal)).rejects.toThrow('过期');expect(await readFile(path,'utf8')).toBe('someone changed it');expect((await readdir(work)).some(n=>n.startsWith('.wisp'))).toBe(false);
 await writeFile(path,'two two');await expect(tool.prepare!(a,new AbortController().signal)).rejects.toThrow('歧义');await writeFile(path,'two');const cancel=await tool.prepare!(a,new AbortController().signal);await expect(cancel.execute(AbortSignal.abort())).rejects.toThrow();expect(await readFile(path,'utf8')).toBe('two');
 await expect(tool.prepare!({...a,sha256:'0'.repeat(64)},new AbortController().signal)).rejects.toThrow('版本');
 }finally{await rm(root,{recursive:true,force:true});}
});
