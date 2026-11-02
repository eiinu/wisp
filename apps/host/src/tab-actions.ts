import {randomUUID} from 'node:crypto';
import type {Notice,Result,Tool,PreviewTabAction} from '@wisp/core';
import type {DesktopService} from './desktop-service.js';
import {PreviewTabs,type Listed} from './preview-tabs.js';
import type {WorkspaceFiles} from './files.js';
const argsSchema={parse(a:Record<string,unknown>){if(Object.keys(a).some(k=>!['tabId','action'].includes(k))||typeof a.tabId!=='string'||!a.tabId||a.tabId.length>100||!['reload','back','forward','close'].includes(String(a.action)))throw new Error('必须提供有效 tabId 与 action');return{tabId:a.tabId,action:a.action as PreviewTabAction};}};
interface Pending {session:string;listed:Listed;action:PreviewTabAction;signal:AbortSignal;claimed:boolean;executed:boolean;status?:string;finish(applied:boolean,error?:string):void}
/** Preparation captures identity before delivery. Delivery tickets are transient, one-use and never logged. */
export class TabActions {
 private pending=new Map<string,Pending>();
 constructor(private tabs:PreviewTabs,private publish:(n:Notice)=>void,private desktop?:DesktopService,private timeout=10000){}
 tool(session:string):Tool {
  return {name:'preview_tab_action',description:'先 list_preview_tabs，再直接操作指定 tabId：网页 reload/back/forward/close；文件与目录 reload/close；空白新标签仅 close。不切换活动标签，不读取正文。导航仅报告请求接收，不保证加载成功。',requiresApproval:false,
   inputSchema:{type:'object',properties:{tabId:{type:'string'},action:{type:'string',enum:['reload','back','forward','close']}},required:['tabId','action'],additionalProperties:false},
   validate:a=>{argsSchema.parse(a);},
   prepare:async(a,signal)=>{
    const {tabId,action}=argsSchema.parse(a),listed=this.tabs.capture(session,tabId);
    if(listed.raw.kind!=='web'&&(action==='back'||action==='forward'))throw new Error('前进和后退仅支持网页标签');
    if(listed.raw.kind==='new'&&action!=='close')throw new Error('新标签页没有可刷新的内容');
    await this.tabs.verify(session,listed,signal);
    const safeUrl=listed.raw.url?new URL(listed.raw.url):undefined;if(safeUrl){safeUrl.search='';safeUrl.hash='';}
    return {description:`${action} · ${listed.raw.title} (${listed.raw.kind})\n${safeUrl?.href??listed.raw.path??'工作目录'}\n仅此标签。刷新/导航可能丢弃页面状态；关闭网页还需原生确认。未保存的文件编辑不会被丢弃。`,execute:async signal=>{
     await this.tabs.verify(session,listed,signal);
     const ticket=randomUUID();
     return new Promise<string>((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);this.pending.delete(ticket);this.publish({type:'preview.action.cancel',sessionId:session,ticket});};
      const abort=()=>{cleanup();reject(new Error('标签操作已取消；已发送的原生操作不能回滚，请重新获取标签状态，不自动重试'));};
      const timer=setTimeout(()=>{cleanup();reject(new Error('标签操作确认超时，状态未知；请重新获取标签状态，不自动重试'));},this.timeout);
      const item:Pending={session,listed,action,signal,claimed:false,executed:false,finish:(applied,error)=>{const status=item.status;cleanup();if(!applied||!status)reject(new Error(error??'标签操作未完成或界面已变化；请重新获取标签状态'));else resolve(JSON.stringify({tabId,action,status,contentRead:false,message:status==='navigation_requested'?'导航请求已发送，不代表加载成功；请重新获取列表并查看标签加载状态。':'操作已确认；未读取正文给模型。'}));}};
      this.pending.set(ticket,item);signal.addEventListener('abort',abort,{once:true});this.publish({type:'preview.action',sessionId:session,ticket});
     });
    }};
   },execute:async()=>{throw new Error('标签操作必须先准备并验证标签');}
  };
 }
 private get(session:string,ticket:string){this.tabs.check(session);const p=this.pending.get(ticket);if(!p||p.session!==session||p.signal.aborted)throw new Error('标签操作票据失效');return p;}
 claim(session:string,ticket:string):Result {const p=this.get(session,ticket);if(p.claimed)throw new Error('标签操作已领取');p.claimed=true;return{tabAction:{tab:p.listed.raw,action:p.action}};}
 async execute(session:string,ticket:string,workspace:()=>Promise<WorkspaceFiles>):Promise<Result>{
  const p=this.get(session,ticket);if(!p.claimed||p.executed)throw new Error('标签操作已执行或未领取');p.executed=true;
  try {
   await this.tabs.verify(session,p.listed,p.signal);this.get(session,ticket);
   let result:Result={};
   if(p.listed.raw.kind==='web'){
    if(!this.desktop||!p.listed.native)throw new Error('网页操作仅支持已就绪的桌面标签');
    const native=await this.desktop.call('page.action',{sessionId:session,tabId:p.listed.native.ref,version:p.listed.native.version,action:p.action},p.signal);
    if(!['closed','navigation_requested','cancelled'].includes(native?.status))throw new Error('桌面未确认标签操作');
    p.status=native.status;
   }else if(p.action==='close')p.status='closed';
   else {
    const files=await workspace();p.signal.throwIfAborted();this.get(session,ticket);
    result=p.listed.raw.kind==='file'?{file:await files.read(p.listed.raw.path!)}:{entries:await files.list(p.listed.raw.path??'')};
    p.status='refreshed';
   }
   p.signal.throwIfAborted();this.get(session,ticket);return {...result,actionStatus:p.status};
  }catch(e){p.finish(false,e instanceof Error?e.message:'标签操作失败');throw e;}
 }
 complete(session:string,ticket:string,applied:boolean){const p=this.get(session,ticket);if(!p.claimed||(applied&&!p.executed))throw new Error('标签操作尚未执行');p.finish(applied);}
}
