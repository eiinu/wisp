import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import ipaddr from 'ipaddr.js';
import {abortable} from './agent.js';
export const networkLimits={bytes:8*1024*1024,text:256*1024,redirects:4,timeout:20000};
export function publicAddress(address:string){
 try{const ip=ipaddr.parse(address);return ip.range()==='unicast' && !(ip.kind()==='ipv6' && !(ip as ipaddr.IPv6).match(ipaddr.parse('2000::') as ipaddr.IPv6,3));}catch{return false;}
}
export function publicUrl(input:string){
 if(typeof input!=='string'||input.length>2048||/[\x00-\x20]/.test(input))throw new Error('需要公开 HTTPS URL');
 const u=new URL(input);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port&&u.port!=='443'||/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(u.hostname))throw new Error('只支持公开 HTTPS 默认端口，无凭据或片段');return u;
}
export const displayUrl=(input:string)=>{const u=publicUrl(input);return u.origin+u.pathname+(u.search?'?[参数已隐藏]':'');};
export interface HttpReply {status:number;headers:Record<string,string|undefined>;body:Buffer}
export type HttpTransport=(url:URL,address:string,family:4|6,signal:AbortSignal,max:number)=>Promise<HttpReply>;
/** Fixed DNS result is used for the socket; TLS still verifies the original hostname. No cookies/proxy credentials. */
export const pinnedHttps:HttpTransport=(url,address,family,signal,max)=>new Promise((resolve,reject)=>{
 const req=request(url,{method:'GET',agent:false,signal,lookup:((_host:any,opts:any,cb:any)=>{if(opts?.all)cb(null,[{address,family}]);else cb(null,address,family);}) as any,headers:{Accept:'text/plain, text/html, application/zip, application/octet-stream;q=0.8','Accept-Encoding':'identity','User-Agent':'Wisp/1'}},res=>{
  const headers=Object.fromEntries(Object.entries(res.headers).map(([k,v])=>[k,Array.isArray(v)?v.join(','):v]));
  if(res.statusCode&&res.statusCode>=300&&res.statusCode<400){res.destroy();resolve({status:res.statusCode,headers,body:Buffer.alloc(0)});return;}
  if(Number(headers['content-length'])>max||headers['content-encoding']&&headers['content-encoding']!=='identity'){res.destroy();reject(new Error('响应过大或不支持压缩传输'));return;}
  const parts:Buffer[]=[];let size=0;
  res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>max){res.destroy(new Error('HTTP 响应超过大小上限'));return;}parts.push(chunk);});
  res.on('error',()=>reject(new Error('HTTP 响应中断或超过大小上限')));
  res.on('end',()=>resolve({status:res.statusCode??0,headers,body:Buffer.concat(parts)}));
 });req.on('error',()=>reject(new Error(signal.aborted?'HTTP 已取消或超时':'HTTPS 请求失败（未携带 Cookie/凭据）')));req.end();
});
export class PublicHttp {
 constructor(private resolveHost=async(host:string)=>lookup(host,{all:true}),private transport:HttpTransport=pinnedHttps){}
 async get(input:string,outer:AbortSignal,max=networkLimits.bytes){
  const signal=AbortSignal.any([outer,AbortSignal.timeout(networkLimits.timeout)]);let url=publicUrl(input);const origins:string[]=[];
  for(let hop=0;hop<=networkLimits.redirects;hop++){
   signal.throwIfAborted();const host=url.hostname.replace(/^\[|\]$/g,'');
   const addresses=await abortable(this.resolveHost(host),signal);
   if(!addresses.length||addresses.length>32||addresses.some(a=>!publicAddress(a.address)))throw new Error('拒绝私网、本机、保留或混合 DNS 地址');
   const a=addresses[0];const reply=await abortable(this.transport(url,a.address,a.family as 4|6,signal,max),signal);signal.throwIfAborted();origins.push(displayUrl(url.href));
   if(reply.status>=300&&reply.status<400){if(![301,302,303,307,308].includes(reply.status)||!reply.headers.location||hop===networkLimits.redirects)throw new Error('重定向无效或过多');url=publicUrl(new URL(reply.headers.location,url).href);continue;}
   if(reply.status<200||reply.status>=300)throw new Error(`HTTP 状态 ${reply.status}`);
   if(reply.body.length>max)throw new Error('HTTP 响应超过大小上限');
   return {body:reply.body,contentType:(reply.headers['content-type']??'').split(';')[0].toLowerCase(),source:displayUrl(input),finalUrl:displayUrl(url.href),redirects:origins};
  }throw new Error('重定向失败');
 }
 async text(url:string,signal:AbortSignal){const r=await this.get(url,signal,networkLimits.text);if(!/^(text\/|application\/(json|xml|x-yaml|yaml))/.test(r.contentType))throw new Error('响应不是支持的文本类型');let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(r.body);}catch{throw new Error('仅支持 UTF-8 文本');}if(/[\x00-\x08\x0b\x0e-\x1f]/.test(text))throw new Error('不是纯文本');return {...r,body:undefined,text,untrusted:true};}
}
