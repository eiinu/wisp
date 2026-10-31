import {it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {trashOperation} from '../apps/desktop/src/trash.js';
import {WorkspaceFiles} from '../apps/host/src/files.js';
import {treeVersion} from '../apps/host/src/file-tools.js';
it('desktop revalidates root, descendants and version, and uses only system trash API',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wisp-trash-'));try{
 const work=join(root,'work'),privateDir=join(root,'private');await mkdir(work);await mkdir(privateDir);await writeFile(join(work,'file'),'old');const files=await WorkspaceFiles.grant(work,privateDir),signal=new AbortController().signal;
 const payload={root:work,path:'file',digest:(await treeVersion(files,'file',signal)).digest},trash=vi.fn(async()=>{});
 await expect(trashOperation('trash.execute',payload,privateDir,signal,trash,'linux')).rejects.toThrow('不会永久删除');expect(trash).not.toHaveBeenCalled();
 await trashOperation('trash.execute',payload,privateDir,signal,trash,'darwin');expect(trash).toHaveBeenCalledExactlyOnceWith(join(work,'file'));
 await writeFile(join(work,'file'),'changed');await expect(trashOperation('trash.execute',payload,privateDir,signal,trash,'darwin')).rejects.toThrow('过期');expect(trash).toHaveBeenCalledTimes(1);
 await expect(trashOperation('trash.execute',{...payload,path:''},privateDir,signal,trash,'darwin')).rejects.toThrow('根目录');
 }finally{await rm(root,{recursive:true,force:true});}
});
it('trash rechecks directory descendants and rejects newly added private entries',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wisp-trash-tree-'));try{
 const work=join(root,'work'),privateDir=join(root,'private');await mkdir(work);await mkdir(privateDir);await mkdir(join(work,'folder'));await writeFile(join(work,'folder/file'),'old');
 const files=await WorkspaceFiles.grant(work,privateDir),signal=new AbortController().signal,trash=vi.fn(async()=>{});
 const payload={root:work,path:'folder',digest:(await treeVersion(files,'folder',signal)).digest};
 await writeFile(join(work,'folder/file'),'changed');await expect(trashOperation('trash.execute',payload,privateDir,signal,trash,'darwin')).rejects.toThrow('过期');
 const refreshed={...payload,digest:(await treeVersion(files,'folder',signal)).digest};await writeFile(join(work,'folder/.secret'),'private');
 await expect(trashOperation('trash.execute',refreshed,privateDir,signal,trash,'darwin')).rejects.toThrow('隐藏');expect(trash).not.toHaveBeenCalled();
 }finally{await rm(root,{recursive:true,force:true});}
});
