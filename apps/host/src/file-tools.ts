import { constants } from 'node:fs';
import { open, lstat, opendir, unlink, rename, mkdir, link } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
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
export function extendedFileTools(files: WorkspaceFiles): Tool[] {
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
          signal.throwIfAborted(); if(++visited>2000 || matches.length>=100 || readBytes>=8*1024*1024){truncated=true;break;}
          if(entry.name.startsWith('.') || ignored.has(entry.name) || entry.isSymbolicLink()){skipped++;continue;}
          const child=path?`${path}/${entry.name}`:entry.name;
          try {
            await files.resolve(child);
            if(a.mode==='name' && entry.name.toLowerCase().includes(query)) if(!add({path:child}))break;
            if(entry.isDirectory())await walk(child,depth+1);
            else if(a.mode==='content' && entry.isFile()){
              const data=await bytes(files,child,256*1024);readBytes+=data.length;
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
  return [search,patch];
}
