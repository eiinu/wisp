import {it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {WorkspaceFiles} from '../apps/host/src/files.js';
vi.mock('node:fs/promises',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs/promises')>();
 return {...actual,lstat:vi.fn(actual.lstat)};
});
it('rejects cross-device empty directories and nested mounts before creating a destination',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wisp-move-device-'));try{
 const work=join(root,'work'),privateDir=join(root,'private');await mkdir(work);await mkdir(privateDir);await mkdir(join(work,'folder'));await mkdir(join(work,'destination'));
 const files=await WorkspaceFiles.grant(work,privateDir),signal=new AbortController().signal,tool=files.tools().find(t=>t.name==='files_move')!;
 const actual=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
 let changedPath=join(work,'destination');
 vi.mocked(lstat).mockImplementation((async(path:Parameters<typeof lstat>[0],options?:any)=>{
  const stat=await actual.lstat(path,options);
  if(String(path)===changedPath)Object.defineProperty(stat,'dev',{value:typeof stat.dev==='bigint'?stat.dev+1n:stat.dev+1});
  return stat;
 }) as typeof lstat);
 await expect(tool.prepare!({path:'folder',destination:'destination/moved'},signal)).rejects.toThrow('跨磁盘');expect(await readdir(join(work,'destination'))).toEqual([]);
 await writeFile(join(work,'folder/nested'),'safe');changedPath=join(work,'folder/nested');
 await expect(tool.prepare!({path:'folder',destination:'destination/moved'},signal)).rejects.toThrow('跨磁盘');expect(await readFile(join(work,'folder/nested'),'utf8')).toBe('safe');expect(await readdir(join(work,'destination'))).toEqual([]);
 }finally{vi.mocked(lstat).mockReset();await rm(root,{recursive:true,force:true});}
});
