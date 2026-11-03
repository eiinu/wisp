import sharp from 'sharp';
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,open,writeFile,rename,rm,readdir,lstat,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {IMAGE_LIMIT,imageSchema,type ChatImage,type Message,type ModelProvider} from '@wisp/core';
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Immutable, session-owned attachments; neither arbitrary paths nor URLs are accepted. */
export class ImageStore {
 private pending=false;
 constructor(private root:string,private sessionId:string) {if(!uuid.test(sessionId))throw new Error('无效会话');}
 private async directory(){
  const directory=join(this.root,'private-images',this.sessionId);
  await mkdir(directory,{recursive:true,mode:0o700});
  if(await realpath(directory)!==join(await realpath(this.root),'private-images',this.sessionId))throw new Error('图片存储路径异常');
  return directory;
 }
 async import(name:string,data:string):Promise<ChatImage>{
  if(this.pending)throw new Error('图片正在处理，请稍候');this.pending=true;
  try{
   if(data.length>Math.ceil(IMAGE_LIMIT/3)*4||data.length%4!==0||/[^A-Za-z0-9+/=]/.test(data))throw new Error('图片编码无效或超过 10 MiB');
   const bytes=Buffer.from(data,'base64');if(bytes.toString('base64')!==data)throw new Error('图片编码无效');if(!bytes.length||bytes.length>IMAGE_LIMIT)throw new Error('每张图片不能超过 10 MiB');
   let output:Buffer,format:string,width:number,height:number;
   try{
    const decoder=sharp(bytes,{failOn:'warning',limitInputPixels:32000000});
    const info=await decoder.metadata();
    if(!['png','jpeg','webp','gif'].includes(info.format??''))throw new Error();
    if(!info.width||!info.height||info.width>8192||info.height>8192||(info.pages??1)>1)throw new Error();
    // Decode and re-encode, discarding EXIF/location metadata, applying orientation.
    // Animated GIF/WebP are rejected rather than silently sending only one frame.
    const normalized=await decoder.rotate().timeout({seconds:5}).toBuffer({resolveWithObject:true});
    output=normalized.data;format=normalized.info.format;width=normalized.info.width;height=normalized.info.height;
   }catch{throw new Error('图片无效：支持静态 JPEG、PNG、WebP、GIF，边长最多 8192，最多 3200 万像素；不支持动画或损坏图片');}
   if(output.length>IMAGE_LIMIT)throw new Error('图片规范化后超过 10 MiB，请压缩后重试');
   const directory=await this.directory();let total=0,count=0;
   for(const file of await readdir(directory))if(file.endsWith('.image')){total+=(await lstat(join(directory,file))).size;count++;}
   if(count>=100||total+output.length>200*1024*1024)throw new Error('此会话图片存储已达上限，请新建会话');
   const image=imageSchema.parse({id:randomUUID(),name:name.split(/[\\/]/).at(-1)?.replace(/[\x00-\x1f\x7f]/g,'').slice(0,160)||'图片',mime:`image/${format}`,size:output.length,width,height,sha256:hash(output)});
   const temp=join(directory,`${image.id}.tmp`),file=join(directory,`${image.id}.image`);
   try{await writeFile(temp,output,{mode:0o600,flag:'wx'});await rename(temp,file);await writeFile(join(directory,`${image.id}.json`),JSON.stringify(image),{mode:0o600,flag:'wx'});}catch(error){await rm(temp,{force:true});await rm(file,{force:true});throw error;}
   return image;
  }finally{this.pending=false;}
 }
 async read(id:string):Promise<{image:ChatImage;dataUrl:string}>{
  if(!uuid.test(id))throw new Error('无效图片 ID');const directory=await this.directory();
  try{
   const meta=await this.safeRead(join(directory,`${id}.json`),4096),image=imageSchema.parse(JSON.parse(meta.toString()));
   if(image.id!==id)throw new Error();const bytes=await this.safeRead(join(directory,`${id}.image`),IMAGE_LIMIT);
   if(bytes.length!==image.size||hash(bytes)!==image.sha256)throw new Error();
   return {image,dataUrl:`data:${image.mime};base64,${bytes.toString('base64')}`};
  }catch{throw new Error('图片不存在、已损坏或不属于此会话；请重新选择图片');}
 }
 private async safeRead(file:string,limit:number){const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await handle.stat();if(!stat.isFile()||stat.size>limit)throw new Error();return await handle.readFile();}finally{await handle.close();}}
 async references(ids:string[]){return Promise.all(ids.map(async id=>(await this.read(id)).image));}
 async hydrate(messages:Message[]){
  let total=0,count=0;const result:Message[]=[];
  for(const message of messages){const images=[];for(const ref of message.images??[]){
   if(message.role!=='user')throw new Error('仅用户消息可包含图片');
   total+=ref.size;count++;if(total>34*1024*1024||count>100)throw new Error('历史图片过多，请新建会话（图片不会被静默移除）');
   const value=await this.read(ref.id);if(value.image.sha256!==ref.sha256)throw new Error('历史图片版本不一致');images.push({...value.image,dataUrl:value.dataUrl});
  }result.push({...message,...(images.length?{images}:{})});}
  if(count>=15&&result.some(m=>m.images?.some(i=>i.width>4096||i.height>4096)))throw new Error('包含 15 张以上历史图片时边长不能超过 4096，请新建会话');
  return result;
 }
 provider(provider:ModelProvider,supported:boolean):ModelProvider{
  const store=this;return {listModels:options=>provider.listModels(options),async *stream(request,options){
   options.signal.throwIfAborted();
   if(request.messages.some(m=>m.images?.length)&&!supported)throw new Error('当前模型不支持图片；请选择视觉模型或新建纯文本会话');
   const messages=request.messages.some(m=>m.images?.length)?await store.hydrate(request.messages):request.messages;options.signal.throwIfAborted();
   yield* provider.stream({...request,messages},options);
  }};
 }
}
