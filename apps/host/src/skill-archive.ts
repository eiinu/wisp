import {crc32} from 'node:zlib';
import yauzl from 'yauzl';
import {createHash} from 'node:crypto';
import {parseSkill} from './skills.js';
export const archiveLimits={entries:200,file:1024*1024,total:8*1024*1024,ratio:100};
export const sha256=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
export type ArchiveFile={path:string;data:Buffer;sha256:string};
export function archivePath(path:string){return path.length<=240&&!path.includes('\\')&&!/[\x00-\x1f:]/.test(path)&&!path.startsWith('/')&&path.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!p.startsWith('.')&&!/[. ]$/.test(p)&&! /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p));}
/** No extraction to filesystem until the entire bounded archive has passed validation. */
export function readArchive(bytes:Buffer,signal:AbortSignal):Promise<ArchiveFile[]> {
 return new Promise((resolve,reject)=>{signal.throwIfAborted();yauzl.fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(error,zip)=>{
  if(error||!zip){reject(new Error('无效 ZIP 包'));return;}const files:ArchiveFile[]=[],names=new Set<string>();let count=0,total=0,done=false;
  const fail=(e:Error)=>{if(done)return;done=true;zip.close();signal.removeEventListener('abort',abort);reject(e);};const abort=()=>fail(new Error('ZIP 检查已取消'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}
  zip.on('error',()=>fail(new Error('ZIP 数据损坏')));zip.on('end',()=>{if(done)return;done=true;signal.removeEventListener('abort',abort);zip.close();resolve(files);});
  zip.on('entry',(entry:yauzl.Entry)=>{
   if(done)return;const directory=entry.fileName.endsWith('/'),path=directory?entry.fileName.slice(0,-1):entry.fileName;
   const mode=(entry.externalFileAttributes>>>16)&0xf000;
   if(++count>archiveLimits.entries||!archivePath(path)||path.split('/').length>7||names.has(path.toLowerCase())||entry.isEncrypted()||![0,8].includes(entry.compressionMethod)||mode!==0&&mode!==(directory?0x4000:0x8000)||entry.extraFields.some(f=>[0x000d,0x756e].includes(f.id))){fail(new Error('ZIP 含重复路径、链接、特殊文件、加密或越界条目'));return;}names.add(path.toLowerCase());
   if(directory){zip.readEntry();return;}total+=entry.uncompressedSize;
   if(entry.uncompressedSize>archiveLimits.file||total>archiveLimits.total||entry.uncompressedSize>Math.max(4096,entry.compressedSize*archiveLimits.ratio)){fail(new Error('ZIP 展开体积或压缩比超限'));return;}
   zip.openReadStream(entry,(error,stream)=>{if(error||!stream){fail(new Error('ZIP 条目不可读'));return;}const chunks:Buffer[]=[];let n=0;
    const cancel=()=>stream.destroy(new Error('取消'));signal.addEventListener('abort',cancel,{once:true});stream.on('error',()=>{signal.removeEventListener('abort',cancel);fail(new Error('ZIP 内容损坏或取消'));});stream.on('data',(chunk:Buffer)=>{n+=chunk.length;if(n>entry.uncompressedSize||n>archiveLimits.file){stream.destroy(new Error('体积超限'));return;}chunks.push(chunk);});stream.on('end',()=>{signal.removeEventListener('abort',cancel);if(done)return;if(n!==entry.uncompressedSize){fail(new Error('ZIP 长度不符'));return;}const data=Buffer.concat(chunks);if(crc32(data)!==entry.crc32){fail(new Error('ZIP CRC 校验失败'));return;}files.push({path,data,sha256:sha256(data)});zip.readEntry();});
   });
  });zip.readEntry();
 });});
}
export function selectSkill(files:ArchiveFile[],root:string){
 if(root!==''&&!archivePath(root))throw new Error('无效技能子目录');const prefix=root?root+'/':'';
 const selected=files.filter(f=>f.path.startsWith(prefix)).map(f=>({...f,path:f.path.slice(prefix.length)}));
 const main=selected.find(f=>f.path==='SKILL.md');if(!main||main.data.length>65536)throw new Error('所选目录缺少完整 SKILL.md 或正文超限');
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(main.data);}catch{throw new Error('SKILL.md 必须为 UTF-8');}
 const meta=parseSkill(text);return {files:selected,meta};
}
