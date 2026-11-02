import {spawn} from 'node:child_process';
import {access,open,realpath,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,basename} from 'node:path';
import {createHash} from 'node:crypto';
export const interpreterNames=['python3','node'] as const;
const search=['/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin'];
export async function binaryIdentity(path:string){
 const canonical=await realpath(path);await access(canonical,constants.X_OK);const f=await open(canonical,constants.O_RDONLY|constants.O_NOFOLLOW);try{
 const before=await f.stat({bigint:true});if(!before.isFile()||before.size>256n*1024n*1024n)throw new Error('运行时不是支持的普通可执行文件');
 const hash=createHash('sha256');for await(const chunk of f.createReadStream({autoClose:false}))hash.update(chunk);
 const after=await f.stat({bigint:true});if(before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||canonical!==await realpath(path))throw new Error('运行时在检查期间改变');
 return {path:canonical,hash:hash.digest('hex'),identity:`${after.dev}:${after.ino}:${after.size}:${after.mtimeNs}:${after.ctimeNs}`};
 }finally{await f.close();}
}
export async function detectInterpreters(){const result=[];for(const name of interpreterNames){let found=false;for(const directory of search){try{const binary=await binaryIdentity(join(directory,name));result.push({name,...binary,available:true,version:'未执行版本探测'});found=true;break;}catch{}}if(!found)result.push({name,available:false});}return result;}
export interface ProcessSpec {executable:string;args:string[];cwd:string;timeoutMs:number}
export interface ProcessResult {exitCode:number|null;signal:string|null;output:string;status:'exited'|'timeout'|'output_limit'|'cancelled';truncated:boolean;cleanupUnconfirmed?:boolean}
export type ProcessRunner=(spec:ProcessSpec,signal:AbortSignal)=>Promise<ProcessResult>;
/** Host-user mode, NOT a sandbox. Process-group cleanup is best effort, not containment against hostile daemons. */
export const runHostProcess:ProcessRunner=(spec,signal)=>new Promise((resolve,reject)=>{
 signal.throwIfAborted();if(process.platform==='win32'){reject(new Error('Windows 进程组取消尚未支持；不执行'));return;}
 const child=spawn(spec.executable,spec.args,{cwd:spec.cwd,shell:false,detached:true,env:{PATH:search.join(':'),HOME:spec.cwd,TMPDIR:spec.cwd,LANG:'en_US.UTF-8',PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
 let output=Buffer.alloc(0),status:ProcessResult['status']='exited',settled=false,escalation:ReturnType<typeof setTimeout>|undefined,deadline:ReturnType<typeof setTimeout>|undefined;
 const kill=(sig:NodeJS.Signals)=>{if(child.pid)try{process.kill(-child.pid,sig);}catch{/* process group already gone */}};
 const stop=(reason:ProcessResult['status'])=>{if(status!=='exited')return;status=reason;kill('SIGTERM');escalation=setTimeout(()=>kill('SIGKILL'),500);deadline=setTimeout(()=>finish(null,null,true),1500);};
 const abort=()=>stop('cancelled');const timeout=setTimeout(()=>stop('timeout'),spec.timeoutMs);
 const clean=()=>{clearTimeout(timeout);if(escalation)clearTimeout(escalation);if(deadline)clearTimeout(deadline);signal.removeEventListener('abort',abort);};
 const collect=(chunk:Buffer)=>{const remaining=65536-output.length;if(chunk.length>remaining){output=Buffer.concat([output,chunk.subarray(0,Math.max(0,remaining))]);stop('output_limit');}else output=Buffer.concat([output,chunk]);};
 child.stdout.on('data',collect);child.stderr.on('data',collect);
 child.once('error',()=>{if(settled)return;settled=true;clean();reject(new Error('运行时无法启动；未安装任何依赖'));});
 child.once('exit',()=>{kill('SIGKILL');if(!deadline)deadline=setTimeout(()=>finish(null,null,true),1500);}); // clean ordinary descendants even if parent exited first
 const finish=(code:number|null,sig:NodeJS.Signals|null,cleanupUnconfirmed=false)=>{if(settled)return;settled=true;kill('SIGKILL');clean();resolve({exitCode:code,signal:sig,output:output.toString('utf8').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x08\x0b\x0e-\x1f]/g,''),status,truncated:status==='output_limit',cleanupUnconfirmed});if(cleanupUnconfirmed){child.stdout.destroy();child.stderr.destroy();child.unref();}};
 child.once('close',(code,sig)=>finish(code,sig));
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
});
