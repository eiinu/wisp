import { randomUUID } from 'node:crypto';
import type { PreviewNotice, Tool } from '@wisp/core';
export function previewUrl(args: Record<string, unknown>) {
  if (Object.keys(args).some(k=>k!=='url') || typeof args.url!=='string' || args.url.length>4096 || /[\u0000-\u001f\u007f]/.test(args.url)) throw new Error('只支持 url 字符串参数');
  let url: URL; try { url=new URL(args.url); } catch { throw new Error('请输入完整 HTTP/HTTPS 地址'); }
  if (!['https:','http:'].includes(url.protocol)||url.username||url.password) throw new Error('网页仅允许不含凭据的 HTTP/HTTPS 地址');
  return url.href;
}
interface Pending { sessionId: string; url: string; claimed: boolean; signal: AbortSignal; finish(accepted: boolean): void }
/** Ephemeral delivery tickets: never persisted or re-emitted by snapshots. */
export class PreviewRequests {
  private pending=new Map<string,Pending>();
  constructor(private publish:(notice:PreviewNotice)=>void,private selected:()=>string|undefined,private timeoutMs=10000){}
  tool(sessionId:string):Tool { return {
    name:'open_webpage',description:'经用户批准，在当前会话右侧打开 HTTP/HTTPS 网页标签。仅请求展示；不读取网页，不保证加载成功。网站可能拒绝嵌入。',
    inputSchema:{type:'object',properties:{url:{type:'string',description:'完整 HTTP/HTTPS 网址，审批时展示给用户'}},required:['url'],additionalProperties:false},requiresApproval:true,
    validate:args=>{previewUrl(args);},execute:async(args,signal)=>{
      const url=previewUrl(args); signal.throwIfAborted();
      if(this.selected()!==sessionId) throw new Error('请切回发起任务的会话后发送新指令；没有打开网页');
      const ticket=randomUUID();
      return new Promise<string>((resolve,reject)=>{
        const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);this.pending.delete(ticket);};
        const abort=()=>{cleanup();reject(new Error('网页打开请求已取消'));};
        const timer=setTimeout(()=>{cleanup();reject(new Error('界面未确认接收网页请求；加载状态未知，不自动重试'));},this.timeoutMs);
        this.pending.set(ticket,{sessionId,url,signal,claimed:false,finish:accepted=>{cleanup();if(!accepted) reject(new Error('界面无法接收网页请求；没有确认打开')); else resolve(JSON.stringify({status:'open_request_accepted',url,contentRead:false,message:'界面已接收标签打开请求；不是网页加载成功或内容读取证明。加载错误见右侧标签；Web 嵌入可能受站点限制。'}));}});
        signal.addEventListener('abort',abort,{once:true});
        this.publish({type:'preview.open',sessionId,ticket});
      });
    }
  }; }
  claim(sessionId:string,ticket:string) {
    const item=this.pending.get(ticket);
    if(!item||item.sessionId!==sessionId||item.claimed||item.signal.aborted||this.selected()!==sessionId) throw new Error('网页请求已失效或不属于当前会话');
    item.claimed=true;return{ticket,url:item.url};
  }
  complete(sessionId:string,ticket:string,accepted:boolean) {
    const item=this.pending.get(ticket);
    if(!item||!item.claimed||item.sessionId!==sessionId||item.signal.aborted) throw new Error('没有匹配的网页请求');
    item.finish(accepted && this.selected()===sessionId);
  }
}
