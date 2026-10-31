import type {Notice,Request,Result,TabActionDelivery} from '@wisp/core';
export type TabActionHandler=(delivery:TabActionDelivery,execute:()=>Promise<Result>,signal:AbortSignal)=>Promise<void>;
export function tabActionDelivery(current:()=>string|undefined,request:(input:Request)=>Promise<Result>,handler:()=>TabActionHandler|undefined){
 const seen=new Set<string>(),pending=new Map<string,AbortController>();
 const deliver=async(n:Extract<Notice,{type:'preview.action'|'preview.action.cancel'}>)=>{
  if(n.type==='preview.action.cancel'){pending.get(n.ticket)?.abort();return;}
  if(current()!==n.sessionId||seen.has(n.ticket))return;seen.add(n.ticket);
  const controller=new AbortController();pending.set(n.ticket,controller);
  const check=()=>{controller.signal.throwIfAborted();if(current()!==n.sessionId)throw new Error('会话已切换');};
  let applied=false;
  try{
   const result=await request({type:'preview.action.claim',sessionId:n.sessionId,ticket:n.ticket});check();
   const run=handler();if(!run||!result.tabAction)throw new Error('标签不可用');
   await run(result.tabAction,async()=>{check();const r=await request({type:'preview.action.execute',sessionId:n.sessionId,ticket:n.ticket});check();return r;},controller.signal);check();applied=true;
  }catch{/* Completion reports failure; no replay or automatic retry. */}
  finally{pending.delete(n.ticket);try{await request({type:'preview.action.complete',sessionId:n.sessionId,ticket:n.ticket,applied});}catch{}}
 };
 return {deliver,dispose(){for(const c of pending.values())c.abort();pending.clear();}};
}
