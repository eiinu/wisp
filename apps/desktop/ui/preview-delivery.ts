import type { PreviewNotice, Request, Result } from '@wisp/core';
import { safeWebUrl } from './preview-model.js';
/** Live subscription only. Historical snapshots never call this consumer. */
export function previewDelivery(current:()=>string|undefined,request:(input:Request)=>Promise<Result>,open:(url:string)=>void) {
  const seen=new Set<string>();
  return async (notice:PreviewNotice)=>{
    if(seen.has(notice.ticket)||notice.sessionId!==current()) return;
    seen.add(notice.ticket);
    let claimed=false;
    try {
      const result=await request({type:'preview.claim',sessionId:notice.sessionId,ticket:notice.ticket}); claimed=true;
      const url=result.preview && safeWebUrl(result.preview.url);
      if(!url||result.preview?.ticket!==notice.ticket||current()!==notice.sessionId) throw new Error('网页请求已失效');
      open(url);
      await request({type:'preview.complete',sessionId:notice.sessionId,ticket:notice.ticket,accepted:true});
    } catch {
      if(claimed) await request({type:'preview.complete',sessionId:notice.sessionId,ticket:notice.ticket,accepted:false}).catch(()=>{});
    }
  };
}
