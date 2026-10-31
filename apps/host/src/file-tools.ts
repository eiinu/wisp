import { fileMutation } from './file-mutation.js';
import { constants } from 'node:fs';
import { open, lstat, opendir, unlink, rename, mkdir, link, rmdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { DesktopService } from './desktop-service.js';
import type { Tool } from '@wisp/core';
import type { WorkspaceFiles } from './files.js';
const ignored = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor', 'target']);
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
function args(input: Record<string, unknown>, keys: string[]) {
  if (!input || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) throw new Error('不支持的参数');
}
function str(input: Record<string, unknown>, key: string, max = 4096) {
  if (typeof input[key] !== 'string' || (input[key] as string).length > max) throw new Error(`${key} 必须是最多 ${max} 字符的字符串`);
  return input[key] as string;
}
function schema(properties: Record<string, unknown>, required: string[]) { return {type:'object', properties, required, additionalProperties:false}; }
const string = {type:'string'};
async function fingerprint(files: WorkspaceFiles, path: string) {
  const target = await files.resolve(path), stat = await lstat(target, {bigint:true});
  if ((!stat.isFile() && !stat.isDirectory()) || (stat.isFile() && stat.nlink > 1n)) throw new Error('不支持链接或特殊文件');
  return {target, identity: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`, directory:stat.isDirectory()};
}
async function bytes(files: WorkspaceFiles, path: string, limit = 200000) {
  const target = await files.resolve(path), handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await handle.stat(); if (!st.isFile() || st.nlink !== 1 || st.size > limit) throw new Error('仅支持大小受限的非链接普通文件');
    const data = Buffer.alloc(limit + 1); let size = 0;
    while (size < data.length) { const read = await handle.read(data, size, data.length - size, null); if (!read.bytesRead) break; size += read.bytesRead; }
    if (size > limit) throw new Error('文件过大');
    return data.subarray(0, size);
  } finally { await handle.close(); }
}
function utf8(data: Buffer) { const text = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(data); if (text.includes('\0')) throw new Error('不支持二进制文件'); return text; }
async function absent(files: WorkspaceFiles, path: string) {
  if (!path) throw new Error('不能操作授权根目录');
  const target = await files.resolve(path, true);
  try { await lstat(target); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return target; throw error; }
  throw new Error('目标已存在，禁止覆盖');
}
export function extendedFileTools(files: WorkspaceFiles, desktop?: DesktopService): Tool[] {
  const search: Tool = {name:'files_search', description:'在授权目录内按文件名或纯文本关键词搜索，返回路径、行号和片段。跳过隐藏、链接、依赖和构建目录；最多检查 2000 项、8 层、每文件 256 KB、总计 8 MB、返回 100 项 / 24000 字符。', requiresApproval:false,
    inputSchema:schema({path:string, query:string, mode:{type:'string',enum:['name','content']}}, ['path','query','mode']),
    validate:async a=>{args(a,['path','query','mode']);str(a,'path');if(!str(a,'query',200).trim())throw new Error('查询不能为空');if(!['name','content'].includes(String(a.mode)))throw new Error('mode 无效');await files.resolve(a.path as string);},
    execute:async(a,signal)=>{
      const matches: {path:string; line?:number; snippet?:string}[]=[]; let visited=0, readBytes=0, output=0, truncated=false, skipped=0;
      const query=(a.query as string).toLowerCase();
      const add=(value:typeof matches[number])=>{const size=JSON.stringify(value).length;if(matches.length>=100 || output+size>24000){truncated=true;return false;}matches.push(value);output+=size;return true;};
      async function walk(path:string,depth:number):Promise<void>{
        signal.throwIfAborted(); if(depth>8){truncated=true;return;}
        const dir=await opendir(await files.resolve(path));
        for await(const entry of dir){
          signal.throwIfAborted(); if(visited>=2000 || matches.length>=100 || readBytes>=8*1024*1024){truncated=true;break;}
          visited++;
          if(entry.name.startsWith('.') || ignored.has(entry.name) || entry.isSymbolicLink()){skipped++;continue;}
          const child=path?`${path}/${entry.name}`:entry.name;
          try {
            await files.resolve(child);
            if(a.mode==='name' && entry.name.toLowerCase().includes(query)) if(!add({path:child}))break;
            if(entry.isDirectory())await walk(child,depth+1);
            else if(a.mode==='content' && entry.isFile()){
              const data=await bytes(files,child,Math.min(256*1024,8*1024*1024-readBytes));readBytes+=data.length;
              const lines=utf8(data).split(/\r?\n/);
              for(let i=0;i<lines.length;i++){signal.throwIfAborted();const index=lines[i].toLowerCase().indexOf(query);if(index>=0&&!add({path:child,line:i+1,snippet:lines[i].slice(Math.max(0,index-80),index+240)}))break;}
            }
          }catch(error){signal.throwIfAborted();skipped++;}
        }
      }
      await walk(a.path as string,0);return JSON.stringify({matches,truncated,skipped,visited,readBytes});
    }};
  const patch: Tool = {name:'files_replace',description:'定点替换 UTF-8 文本中唯一一段 oldText；必须提供 files_read/search 后确认的旧内容。可指定 SHA256。审批显示差异，文件改变后拒绝执行。',requiresApproval:true,
    inputSchema:schema({path:string,oldText:string,newText:string,sha256:string},['path','oldText','newText']),
    validate:async a=>{args(a,['path','oldText','newText','sha256']);if(!str(a,'path'))throw new Error('不能修改根目录');if(!str(a,'oldText',50000))throw new Error('旧内容不能为空');str(a,'newText',50000);if(a.sha256!==undefined&&!/^[a-f0-9]{64}$/.test(str(a,'sha256')))throw new Error('sha256 无效');},
    prepare:async(a,signal)=>{
      signal.throwIfAborted();const path=a.path as string, before=await fingerprint(files,path), data=await bytes(files,path), original=utf8(data), old=a.oldText as string;
      const index=original.indexOf(old);if(index<0||original.indexOf(old,index+1)>=0)throw new Error('旧内容必须恰好匹配一次；不存在或存在歧义');
      const digest=hash(data);if(a.sha256!==undefined&&a.sha256!==digest)throw new Error('内容版本不匹配');
      const next=original.slice(0,index)+(a.newText as string)+original.slice(index+old.length);if(Buffer.byteLength(next)>200000)throw new Error('替换后文件超过 200000 字节');
      return {description:`修改 ${path}\n版本 SHA256: ${digest}\n--- 原内容\n${old}\n+++ 新内容\n${a.newText}\n批准后若文件改变将拒绝执行。`,execute:async signal=>{
        signal.throwIfAborted();const temporary=join(dirname(before.target),`.wisp-replace-${randomUUID()}`);const handle=await open(temporary,'wx',0o600);
        try {
          await handle.writeFile(next,'utf8');await handle.sync();await handle.close();
          if((await fingerprint(files,path)).identity!==before.identity || hash(await bytes(files,path))!==digest)throw new Error('审批已过期：文件发生改变');
          signal.throwIfAborted();await files.resolve(path);await rename(temporary,before.target);
          return JSON.stringify({path,status:'replaced',sha256:hash(Buffer.from(next)),replacements:1});
        }catch(error){await handle.close().catch(()=>{});await unlink(temporary).catch(()=>{});throw error;}
      }};
    },execute:async()=>{throw new Error('必须先准备并批准修改');}};
  return [search,patch,...directoryTools(files,desktop)].map(tool => !tool.prepare ? tool : {...tool, prepare: async(args,signal)=>{
    const prepared=await tool.prepare!(args,signal);return {...prepared,execute:(signal:AbortSignal)=>fileMutation(signal,()=>prepared.execute(signal))};
  }});
}

/** Snapshot every descendant, not a filtered UI listing: hidden/private/link children block mutations. */
export async function treeVersion(files:WorkspaceFiles,path:string,signal:AbortSignal) {
 if(!path)throw new Error('不能操作授权根目录');
 const entries:{path:string;identity:string;directory:boolean}[]=[];
 async function walk(path:string,depth:number):Promise<void>{
  signal.throwIfAborted();if(depth>20||entries.length>=2000)throw new Error('目录过大，最多 2000 项 / 20 层');
  const item=await fingerprint(files,path);entries.push({path,identity:item.identity,directory:item.directory});
  if(item.directory){const dir=await opendir(item.target);for await(const child of dir)await walk(`${path}/${child.name}`,depth+1);}
 }
 await walk(path,0);entries.sort((a,b)=>a.path.localeCompare(b.path));return {entries,digest:hash(Buffer.from(JSON.stringify(entries)))};
}
function directoryTools(files:WorkspaceFiles,desktop?:DesktopService):Tool[]{
 const make=(name:string,description:string,keys:string[],prepare:NonNullable<Tool['prepare']>):Tool=>({name,description,requiresApproval:true,inputSchema:schema(Object.fromEntries(keys.map(k=>[k,string])),keys),validate:a=>{args(a,keys);for(const key of keys){const value=str(a,key);if(!value||value.split('/').some(p=>!p))throw new Error('路径不能为空、不能包含空路径段，不能操作授权根目录');}},prepare,execute:async()=>{throw new Error('必须先准备并批准目录操作');}});
 const mkdirTool=make('files_mkdir','在授权目录中创建一个文件夹（父目录必须存在）；需要批准，不覆盖。',['path'],async(a,signal)=>{
  const path=a.path as string,target=await absent(files,path),parent=await fingerprint(files,dirname(path)==='.'?'':dirname(path));
  return {description:`创建文件夹：${path}。不覆盖已有内容。`,execute:async signal=>{signal.throwIfAborted();await absent(files,path);if((await fingerprint(files,dirname(path)==='.'?'':dirname(path))).identity!==parent.identity)throw new Error('审批已过期：父目录改变');signal.throwIfAborted();await mkdir(target,{mode:0o700});return JSON.stringify({status:'created',path});}};
 });
 const move=make('files_move','在授权目录内移动或重命名文件/目录。目标必须不存在；所有后代须通过权限检查。需要批准。不跨磁盘；目录逐项移动，失败/取消可能部分完成，请检查结果，不自动重试。',['path','destination'],async(a,signal)=>{
  const path=a.path as string,destination=a.destination as string;
  if(destination===path||destination.startsWith(path+'/'))throw new Error('不能移动到自身或子目录');
  await absent(files,destination);const before=await treeVersion(files,path,signal);
  const destParent=dirname(destination)==='.'?'':dirname(destination),parent=await fingerprint(files,destParent);
  return {description:`移动 / 重命名：${path} → ${destination}\n共 ${before.entries.length} 项；版本 ${before.digest}\n目标必须不存在。目录按项移动，取消或失败可能部分完成；不会覆盖或永久删除文件。`,execute:async signal=>{
   signal.throwIfAborted();await absent(files,destination);
   if((await treeVersion(files,path,signal)).digest!==before.digest||(await fingerprint(files,destParent)).identity!==parent.identity)throw new Error('审批已过期：源内容或目标父目录改变');
   let moved=0;
   async function transfer(source:string,dest:string):Promise<void>{
    signal.throwIfAborted();const item=await fingerprint(files,source),approved=before.entries.find(e=>e.path===source);
    // Directory metadata changes as its approved children are moved; its inode must stay fixed.
    if(!approved|| (item.directory?item.identity.split(':').slice(0,2).join(':')!==approved.identity.split(':').slice(0,2).join(':'):item.identity!==approved.identity))throw new Error('移动期间源内容改变');
    const target=await absent(files,dest);signal.throwIfAborted();
    if(item.directory){
     await mkdir(target,{mode:0o700});
     const children=before.entries.filter(e=>dirname(e.path)===source);
     for(const child of children)await transfer(child.path,`${dest}/${basename(child.path)}`);
     signal.throwIfAborted();await files.resolve(source);await rmdir(item.target);
    }else{
     // link is an atomic no-clobber destination claim; unlike rename it never overwrites.
     await link(item.target,target);
     const origin=await lstat(await files.resolve(source),{bigint:true}),copied=await lstat(await files.resolve(dest),{bigint:true});
     if(`${origin.dev}:${origin.ino}`!==approved.identity.split(':').slice(0,2).join(':')||origin.ino!==copied.ino||origin.dev!==copied.dev)throw new Error('移动期间文件被替换；保留两侧供检查');
     signal.throwIfAborted();await unlink(item.target);
    }
    moved++;
   }
   try{await transfer(path,destination);}catch(error){throw new Error(`移动未完全完成（已完成 ${moved} 项），请检查 ${path} 和 ${destination}，不要自动重试：${error instanceof Error?error.message:'失败'}`);}
   return JSON.stringify({status:'moved',path:destination,source:path,items:moved});
  }};
 });
 const trash=make('files_trash','将授权目录内文件/文件夹移到系统废纸篓，需明确批准。仅桌面支持；不永久删除，不操作授权根。',['path'],async(a,signal)=>{
  if(!desktop)throw new Error('系统废纸篓仅支持桌面版，不会降级为永久删除');
  const path=a.path as string,before=await treeVersion(files,path,signal);
  // Check capability before asking for approval, without accessing the system trash.
  await desktop.call('trash.available',{},signal);
  return {description:`移入系统废纸篓：${path}\n共 ${before.entries.length} 项；版本 ${before.digest}\n可通过系统废纸篓恢复；不会永久删除。`,execute:async signal=>{
   signal.throwIfAborted();if((await treeVersion(files,path,signal)).digest!==before.digest)throw new Error('审批已过期：源内容改变');
   return JSON.stringify(await desktop.call('trash.execute',{root:files.root,path,digest:before.digest},signal));
  }};
 });
 return [mkdirTool,move,trash];
}
