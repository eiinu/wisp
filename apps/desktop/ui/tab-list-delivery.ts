import type {Notice,Request,Result,PreviewTabMetadata} from '@wisp/core';
/** Only live, claimed requests; never replayed from historical events. */
export function tabListDelivery(current:()=>string|undefined,request:(input:Request)=>Promise<Result>,read:()=>PreviewTabMetadata[]) {
 const seen=new Set<string>();
 return async(notice:Extract<Notice,{type:'preview.tabs'}>)=>{
  if(current()!==notice.sessionId||seen.has(notice.ticket))return;
  seen.add(notice.ticket);
  try{
   await request({type:'preview.tabs.claim',sessionId:notice.sessionId,ticket:notice.ticket});
   if(current()!==notice.sessionId)return;
   await request({type:'preview.tabs.complete',sessionId:notice.sessionId,ticket:notice.ticket,tabs:read()});
  }catch{/* Expired, cancelled or disconnected tickets do not retry. */}
 };
}
