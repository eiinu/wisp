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
