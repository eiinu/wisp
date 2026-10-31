import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Ajv } from 'ajv';
import { mcpConfigSchema, type Tool, type McpConfig } from '@wisp/core';
import type { LocalMcp } from './local-mcp.js';

const registry='https://registry.npmjs.org';
const path='/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';
export type SetupRunner=(command:string,args:string[],cwd:string,signal:AbortSignal)=>Promise<string>;
/** No shell, inherited credentials, npm user config, or raw process diagnostics. */
export const runSetup:SetupRunner=async(command,args,cwd,signal)=>new Promise((resolve,reject)=>{
 signal.throwIfAborted();
 const child=spawn(command,args,{cwd,shell:false,env:{PATH:path,HOME:cwd,TMPDIR:cwd,LANG:'en_US.UTF-8'},stdio:['ignore','pipe','pipe']});
 let text='',overflow=false,kill:ReturnType<typeof setTimeout>|undefined;
 const abort=()=>{child.kill('SIGTERM');kill=setTimeout(()=>child.kill('SIGKILL'),1000);};
 const clean=()=>{if(kill)clearTimeout(kill);signal.removeEventListener('abort',abort);};
 child.stdout.on('data',data=>{if(text.length+data.length>4096){overflow=true;return;}text+=String(data);});
 child.stderr.on('data',()=>{});
 child.once('error',()=>{clean();reject(new Error('找不到或无法启动所需 Node/npm；请在本机安装 Node 与 npm 12+，再重新发起请求'));});
 child.once('close',code=>{clean();if(signal.aborted)reject(new Error('安装已取消或超时；可能保留部分下载，请查看设置后再决定下一步，不自动重试'));
  else if(code!==0)reject(new Error('包管理器执行失败；未激活 MCP。可能需要网络、运行时或安装脚本，本功能不会执行这些脚本'));
  else resolve(overflow?'':text.trim());});
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
});
const str={type:'string',minLength:1,maxLength:200};
const argsSchema={type:'array',maxItems:32,items:{type:'string',maxLength:1000}};
const packagePattern='^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$';
const versionPattern='^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$';
const configSchema={type:'object',properties:{name:str,command:{...str,description:'已经安装的可执行文件绝对路径；不是 shell、npx 或包管理器'},args:argsSchema,cwd:{type:'string',maxLength:4096}},required:['name','command','args'],additionalProperties:false};
const npmSchema={type:'object',properties:{name:str,package:{type:'string',pattern:packagePattern,maxLength:214},version:{type:'string',pattern:versionPattern,maxLength:80},bin:{type:'string',pattern:'^[a-zA-Z0-9][a-zA-Z0-9._-]*$',maxLength:100},args:argsSchema},required:['name','package','version','bin','args'],additionalProperties:false};
const idSchema={type:'object',properties:{id:{type:'string',pattern:'^[0-9a-f-]{36}$'}},required:['id'],additionalProperties:false};
const emptySchema={type:'object',properties:{},additionalProperties:false};
const forbidden=/^(?:ba|z|da|fi|k|c)?sh$|^(?:cmd|powershell|pwsh|npx|npm|pnpm|yarn|bunx|uv|uvx|env|sudo|osascript|open)(?:\.exe)?$/i;
function safeArgs(args:string[]){if(args.some(value=>/[\x00-\x1f]/.test(value)||/^(?:-e|-c|--eval|--print|--require|--import)(?:=|$)/.test(value)||/(?:token|password|secret|api[_-]?key)(?:\s*=|$)/i.test(value)))throw new Error('参数包含控制字符、内联执行或疑似秘密；密钥请在设置 → 本地 MCP 的环境变量表单填写');}
function validate(schema:object,args:Record<string,unknown>){if(!new Ajv({strict:false}).compile(schema)(args))throw new Error('MCP 安装参数无效：只支持明确字段、精确版本和标准 npm 包名；不能提供 URL、shell 或环境变量值');}
async function executable(command:string){if(!isAbsolute(command)||forbidden.test(basename(command)))throw new Error('请指定已安装服务的绝对可执行路径，不支持 shell/包管理器命令；npm 包请使用 mcp_install_npm');await access(command,constants.X_OK);return realpath(command);}
async function findExecutable(name:string){for(const directory of path.split(':')){try{return await executable(join(directory,name));}catch{}}throw new Error(`未找到 ${name}，请在本机安装 Node 与 npm 12+；不会自动安装运行时`);}
// npm is only invoked with fixed arguments, unlike registered arbitrary service commands.
async function findNpm(){for(const directory of path.split(':')){try{const file=join(directory,'npm');await access(file,constants.X_OK);return await realpath(file);}catch{}}throw new Error('未找到 npm；请在本机安装 Node 与 npm 12+');}
export function checkLock(lock:any,pkg:string,version:string){
 if(lock?.lockfileVersion!==3||!lock.packages||Object.keys(lock.packages).length>2048)throw new Error('不支持的依赖锁文件或依赖数量过多');
 if(lock.packages[`node_modules/${pkg}`]?.version!==version)throw new Error('锁文件版本与批准的包版本不一致');
 for(const [key,item] of Object.entries<any>(lock.packages)){
  if(!key)continue;
  if(!key.startsWith('node_modules/')||key.split('/').some(p=>p==='..'||p==='.')||key.includes('\\')||item.link)throw new Error('拒绝本地链接或越界依赖');
  let url:URL;try{url=new URL(item.resolved);}catch{throw new Error('依赖缺少 registry 来源');}
  if(url.origin!==registry||url.username||url.password||url.search||url.hash||!/^sha512-[A-Za-z0-9+/]+=*$/.test(item.integrity??''))throw new Error('拒绝非官方 registry 或缺少 sha512 完整性校验的依赖');
 }
}
/** Reuses Agent approval tickets. No installation or activation occurs during prepare. */
export class McpSetup {
 private busy=false;
 private stopping=new AbortController();
 private tasks=new Set<Promise<string>>();
 async shutdown(){this.stopping.abort();await Promise.allSettled([...this.tasks]);}
 constructor(private directory:string,private mcp:LocalMcp,private runner:SetupRunner=runSetup,private binaries=async()=>({node:await findExecutable('node'),npm:await findNpm()})){}
 private record(id:string){const s=this.mcp.snapshot().find(s=>s.id===id);if(!s)throw new Error('MCP 配置不存在，请重新列出');return s;}
 private async exclusive<T>(work:()=>Promise<T>){if(this.busy)throw new Error('已有 MCP 安装/注册正在执行，请等待并检查结果，不自动重试');this.busy=true;try{return await work();}finally{this.busy=false;}}
 private tool(name:string,description:string,inputSchema:object,prepare:NonNullable<Tool['prepare']>):Tool{return {name,description,inputSchema:inputSchema as Record<string,unknown>,requiresApproval:true,validate:args=>validate(inputSchema,args),prepare:async(args,signal)=>{validate(inputSchema,args);signal.throwIfAborted();const prepared=await prepare(structuredClone(args),signal);let used=false;return {...prepared,execute:async signal=>{signal.throwIfAborted();if(used)throw new Error('审批已消费，不可重复执行');used=true;const combined=AbortSignal.any([signal,this.stopping.signal]);combined.throwIfAborted();const task=prepared.execute(combined);this.tasks.add(task);try{return await task;}finally{this.tasks.delete(task);}}};},execute:async()=>{throw new Error('必须先准备并批准 MCP 操作');}};}
 tools():Tool[]{return [
  {name:'mcp_list_services',description:'列出已配置 MCP 的 ID、状态、环境变量名称（无值）和工具数量，避免重复安装。配置为应用级，不受项目目录限制。',inputSchema:emptySchema,requiresApproval:false,validate:args=>validate(emptySchema,args),execute:async()=>JSON.stringify(this.mcp.snapshot().map(s=>({id:s.id,name:s.name,state:s.state,envNames:s.envNames,tools:s.tools.length})))},
  this.tool('mcp_register','注册已安装的本机 stdio MCP，审批后持久保存为禁用。不安装软件、不执行命令。不得请求密钥值；需要密钥时引导用户在设置 → 本地 MCP 编辑环境变量。',configSchema,async args=>{
   const config=mcpConfigSchema.parse(args);safeArgs(config.args);const command=await executable(config.command);const identity=await lstat(command);const cwd=config.cwd?await realpath(config.cwd):undefined;if(forbidden.test(basename(command)))throw new Error('不支持命令解释器');if(config.cwd&&!(await lstat(config.cwd)).isDirectory())throw new Error('工作目录不存在');
   return {description:`注册已有本地 MCP（不安装、不启动）\n名称：${config.name}\n命令：${command}\n参数：${JSON.stringify(config.args)}\n目录：${config.cwd??'用户主目录'}\n影响：保存应用级配置，保持禁用。该进程激活后具有本机权限，不受项目目录限制。密钥仅在设置的环境变量表单填写。`,execute:signal=>this.exclusive(async()=>{signal.throwIfAborted();const current=await lstat(command);if(await executable(config.command)!==command||identity.ino!==current.ino||identity.dev!==current.dev||identity.size!==current.size||identity.mtimeMs!==current.mtimeMs||(config.cwd&&await realpath(config.cwd)!==cwd))throw new Error('可执行文件或目录已变化，请重新确认');return this.register({...config,command});})};
  }),
  this.tool('mcp_install_npm','审批后从 https://registry.npmjs.org 安装精确版本 npm MCP 到 Wisp 专用目录并注册为禁用。需要本机 Node 和 npm 12+。不执行安装脚本，不支持 git/URL/私有 registry/本地依赖；需要编译或 postinstall 的包可能不可用。先根据用户提供说明确定包、版本、bin，不猜测。密钥不得放参数。',npmSchema,async args=>{
   const p=args as {name:string;package:string;version:string;bin:string;args:string[]};safeArgs(p.args);
   const key=createHash('sha256').update(JSON.stringify(p)).digest('hex').slice(0,32),target=join(this.directory,'mcp-installs',key);
   return {description:`安装并注册 MCP，安装后保持禁用\n来源：${registry}（公共 registry，不代表包可信）\n包：${p.package}@${p.version}\n名称：${p.name}；入口：${p.bin}\n启动参数：${JSON.stringify(p.args)}\n目录：${target}\n命令：npm install --package-lock-only；校验来源/完整性后 npm ci（均 --ignore-scripts，禁止 git/URL/本地依赖）\n将联网下载依赖并写入专用目录；不运行安装脚本，不安装全局包，不自动激活。失败/取消可能保留部分下载。密钥仅在设置填写。`,execute:signal=>this.exclusive(()=>this.install(p,target,signal))};
  }),
  this.tool('mcp_activate_service','激活一个已注册 MCP 并检查协议与工具列表。需要独立明确审批；第三方进程以本机权限执行。密钥只在设置 → 本地 MCP 填写。失败不得自动重试。',idSchema,async args=>{
   const initial=this.record(String(args.id));const revision=this.mcp.configurationRevision(initial.id);const fingerprint=JSON.stringify([initial.command,initial.args,initial.cwd,initial.envNames,initial.envStorage]);
   return {description:`信任并启动本机 MCP「${initial.name}」\n命令：${initial.command}\n参数：${JSON.stringify(initial.args)}\n目录：${initial.cwd??'用户主目录'}\n环境变量名称：${initial.envNames.join('、')||'无'}\n该程序可使用本机权限，不受项目目录沙箱约束；连接后发现工具，每次第三方工具调用仍需审批。`,execute:async signal=>{
    const current=this.record(initial.id);if(revision!==this.mcp.configurationRevision(initial.id)||fingerprint!==JSON.stringify([current.command,current.args,current.cwd,current.envNames,current.envStorage]))throw new Error('MCP 配置已变化，请重新确认');signal.throwIfAborted();
    const cancel=()=>{void this.mcp.disable(initial.id);};signal.addEventListener('abort',cancel,{once:true});
    try{await this.mcp.activate(initial.id);signal.throwIfAborted();const result=this.record(initial.id);return JSON.stringify({id:initial.id,state:result.state,tools:result.tools.map(t=>({name:t.name,tool:t.remoteName})),message:'协议连接和工具发现完成；未调用第三方工具'});}finally{signal.removeEventListener('abort',cancel);}
   }};
  })
 ];}
 private async register(config:McpConfig){const existing=this.mcp.snapshot().find(s=>JSON.stringify([s.command,s.args,s.cwd??''])===JSON.stringify([config.command,config.args,config.cwd??'']));if(existing)return JSON.stringify({id:existing.id,state:existing.state,alreadyConfigured:true,message:'相同命令已注册，没有重复保存或启动'});const id=await this.mcp.save(undefined,config,{},false);return JSON.stringify({id,state:'disabled',installed:false,message:'已注册配置，尚未激活。需要密钥时请在设置 → 本地 MCP 编辑环境变量，再单独确认激活'});}
 private async install(p:{name:string;package:string;version:string;bin:string;args:string[]},target:string,outer:AbortSignal){
  const signal=AbortSignal.any([outer,AbortSignal.timeout(180000)]);signal.throwIfAborted();
  if(this.mcp.snapshot().length>=16)throw new Error('配置已达 16 个，请先在设置中维护；未下载包');
  const binaries=await this.binaries();await mkdir(target,{recursive:true,mode:0o700});
  const stat=await lstat(target);if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(target)!==resolve(target))throw new Error('安装目录不安全');
  // Durable marker avoids repeated installs after retries/restarts. Never reuse partial installs.
  const marker=join(target,'installed.json');let done:any;try{done=JSON.parse(await readFile(marker,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('安装状态无法读取，请检查专用目录，不自动覆盖');}
  if(!done){
   try{await writeFile(join(target,'attempt'),'',{flag:'wx',mode:0o600});}catch{throw new Error('此方案已有安装尝试；可能部分完成，不自动重试。请检查专用目录或手动安装后注册');}
   await writeFile(join(target,'user.npmrc'),'',{flag:'wx',mode:0o600});await writeFile(join(target,'global.npmrc'),'',{flag:'wx',mode:0o600});
   const flags=['--ignore-scripts','--no-audit','--no-fund','--allow-git=none','--allow-remote=none','--allow-file=none','--allow-directory=none',`--registry=${registry}`,`--userconfig=${join(target,'user.npmrc')}`,`--globalconfig=${join(target,'global.npmrc')}`,`--cache=${join(target,'cache')}`,'--workspaces=false','--bin-links=false'];
   const version=await this.runner(binaries.npm,['--version',...flags],target,signal);if(!/^1[2-9]\./.test(version)&&!/^([2-9]\d|\d{3,})\./.test(version))throw new Error('需要 npm 12+ 的来源限制功能；请更新本机 npm 后手动安装并注册，当前不会下载包');
   await writeFile(join(target,'package.json'),JSON.stringify({name:'wisp-private-mcp-install',private:true,version:'1.0.0',dependencies:{[p.package]:p.version}}),{flag:'wx',mode:0o600});
   await this.runner(binaries.npm,['install','--package-lock-only',...flags],target,signal);signal.throwIfAborted();
   const lockFile=join(target,'package-lock.json');if((await lstat(lockFile)).size>4*1024*1024)throw new Error('锁文件超过限制');checkLock(JSON.parse(await readFile(lockFile,'utf8')),p.package,p.version);
   await this.runner(binaries.npm,['ci',...flags],target,signal);signal.throwIfAborted();
   done={package:p.package,version:p.version,bin:p.bin};await writeFile(marker,JSON.stringify(done),{flag:'wx',mode:0o600});
  }
  if(done.package!==p.package||done.version!==p.version||done.bin!==p.bin)throw new Error('安装记录不匹配');
  const root=join(target,'node_modules',p.package);if(await realpath(root)!==resolve(root))throw new Error('安装包目录不安全');
  const manifestFile=join(root,'package.json');if((await lstat(manifestFile)).size>1024*1024)throw new Error('包清单超过限制');const manifest=JSON.parse(await readFile(manifestFile,'utf8'));
  if(manifest.name!==p.package||manifest.version!==p.version)throw new Error('安装后的包身份不符');
  const bin=typeof manifest.bin==='string'&&p.bin===p.package.split('/').at(-1)?manifest.bin:manifest.bin?.[p.bin];
  if(typeof bin!=='string'||isAbsolute(bin)||bin.split(/[\\/]/).some(s=>s==='..'))throw new Error('找不到安全的 Node bin 入口；请核对包安装说明');
  const entry=await realpath(join(root,bin)),rel=relative(await realpath(root),entry);if(rel.startsWith('..'+sep)||rel==='..'||isAbsolute(rel)||!(await lstat(entry)).isFile())throw new Error('入口越出包目录');
  if(!/\.(?:[cm]?js)$/.test(entry))throw new Error('首版只支持 JavaScript bin；不执行 shell 或原生入口');
  signal.throwIfAborted();const result=JSON.parse(await this.register({name:p.name,command:binaries.node,args:[entry,...p.args],cwd:target}));return JSON.stringify({...result,installed:true,package:p.package,version:p.version,installDirectory:target,message:'包已安装（安装脚本未运行），配置已注册；本次未启动服务，当前连接状态见 state。请填写所需环境变量后单独确认激活检查'});
 }
}
