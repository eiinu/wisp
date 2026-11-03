import React,{useEffect,useRef,useState} from 'react';
import {IMAGE_COUNT,IMAGE_LIMIT,type ChatImage,type Request,type Result} from '@wisp/core';
import {WorkspaceIcon} from './workspace-icon.js';
import './chat-images.css';
export interface DraftImage {key:string;name:string;data:string;url:string}
export function ImagePicker({images,onChange,disabled,onError,onPending,pasteTarget}:{images:DraftImage[];onChange(images:DraftImage[]):void;disabled:boolean;onError(message:string):void;onPending(value:boolean):void;pasteTarget:React.RefObject<HTMLTextAreaElement|null>}){
 const input=useRef<HTMLInputElement>(null),live=useRef(true),lock=useRef(false),current=useRef({images,disabled,onChange,onError,onPending});current.current={images,disabled,onChange,onError,onPending};
 const readers=useRef(new Set<FileReader>());
 useEffect(()=>{live.current=true;return()=>{live.current=false;for(const reader of readers.current)reader.abort();current.current.onPending(false);};},[]);
 const add=async(files:File[])=>{
  const state=current.current;if(state.disabled||lock.current||!files.length)return;
  if(files.length+state.images.length>IMAGE_COUNT){state.onError('每次最多选择 4 张图片');return;}
  if(files.some(f=>f.size>IMAGE_LIMIT||!f.size)){state.onError('每张图片必须非空且不超过 10 MiB');return;}
  if(files.some(f=>!['image/png','image/jpeg','image/webp','image/gif'].includes(f.type))){state.onError('请选择 JPEG、PNG、WebP 或 GIF 图片');return;}
  lock.current=true;state.onPending(true);
  try{
   const added:DraftImage[]=[];
   for(const file of files){const url=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();readers.current.add(reader);reader.onload=()=>{readers.current.delete(reader);resolve(String(reader.result));};reader.onerror=reader.onabort=()=>{readers.current.delete(reader);reject(new Error('图片读取已取消或失败'));};reader.readAsDataURL(file);});added.push({key:crypto.randomUUID(),name:file.name.slice(0,160)||'粘贴图片',url,data:url.slice(url.indexOf(',')+1)});}
   if(live.current)state.onChange([...state.images,...added]);
  }catch(error){if(live.current)state.onError(error instanceof Error?error.message:'图片读取失败');}
  finally{lock.current=false;if(live.current)state.onPending(false);}
 };
 useEffect(()=>{const target=pasteTarget.current;if(!target)return;const paste=(event:ClipboardEvent)=>{const files=Array.from(event.clipboardData?.files??[]);if(!files.length)return;event.preventDefault();void add(files);};target.addEventListener('paste',paste);return()=>target.removeEventListener('paste',paste);},[pasteTarget]);
 return <div className="chat-images-picker"><div className="chat-image-list">{images.map(image=><figure key={image.key}><img src={image.url} alt={image.name}/><figcaption title={image.name}>{image.name}</figcaption><button type="button" disabled={disabled||lock.current} aria-label={`移除图片 ${image.name}`} onClick={()=>onChange(images.filter(i=>i.key!==image.key))}><WorkspaceIcon name="close"/></button></figure>)}</div><div className="chat-image-controls"><input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden aria-label="选择图片文件" disabled={disabled} onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value='';void add(files);}}/><button type="button" disabled={disabled||images.length>=IMAGE_COUNT||lock.current} onClick={()=>input.current?.click()}><WorkspaceIcon name="image"/>添加图片</button><small>最多 4 张 · 每张 10 MiB · 静态图片</small></div></div>;
}
export function MessageImages({images,sessionId,request,onResend}:{images:ChatImage[];sessionId:string;request(input:Request):Promise<Result>;onResend?(images:DraftImage[]):void}){
 const [urls,setUrls]=useState<Record<string,string>>({}),[error,setError]=useState(''),[pending,setPending]=useState(false);const lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;let live=true;setUrls({});setError('');void(async()=>{try{const next:Record<string,string>={};for(const image of images){const result=await request({type:'images.read',sessionId,id:image.id});if(!result.imageDataUrl)throw new Error('图片不可用');next[image.id]=result.imageDataUrl;}if(live)setUrls(next);}catch{if(live)setError('本地图片不可用，请重新选择；不会发送缺失的图片');}})();return()=>{live=false;alive.current=false;};},[sessionId,images.map(i=>i.id).join(',')]);
 const resend=()=>{if(lock.current||!onResend)return;lock.current=true;setPending(true);try{onResend(images.map(i=>({key:crypto.randomUUID(),name:i.name,url:urls[i.id],data:urls[i.id].split(',')[1]})));}finally{lock.current=false;if(alive.current)setPending(false);}};
 return <div className="message-images"><div className="chat-image-list">{images.map(image=><figure key={image.id}>{urls[image.id]?<img src={urls[image.id]} alt={image.name} loading="lazy"/>:<span>图片</span>}<figcaption title={image.name}>{image.name}</figcaption></figure>)}</div>{error&&<small role="status">{error}</small>}{onResend&&<button type="button" disabled={pending||images.some(i=>!urls[i.id])} onClick={resend}>将图片加入输入框</button>}</div>;
}
