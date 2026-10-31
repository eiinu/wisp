import { WorkspaceFiles } from '../../host/src/files.js';
import { treeVersion } from '../../host/src/file-tools.js';
/** Private Host IPC only. There is deliberately no Renderer trash endpoint. */
export async function trashOperation(operation:string,input:Record<string,unknown>,privateDirectory:string,signal:AbortSignal,trash:(path:string)=>Promise<void>,platform=process.platform) {
 signal.throwIfAborted();if(!['darwin','win32'].includes(platform))throw new Error('此平台尚未支持已验证的系统废纸篓，不会永久删除');
 if(operation==='trash.available')return {supported:true};
 if(operation!=='trash.execute'||typeof input.root!=='string'||typeof input.path!=='string'||typeof input.digest!=='string')throw new Error('无效废纸篓请求');
 const files=await WorkspaceFiles.grant(input.root,privateDirectory);
 if((await treeVersion(files,input.path,signal)).digest!==input.digest)throw new Error('审批已过期，文件或目录发生变化');
 const target=await files.resolve(input.path);signal.throwIfAborted();await trash(target);
 return {status:'trashed',path:input.path,message:'已移入系统废纸篓，可通过系统恢复。'};
}
