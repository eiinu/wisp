import {it,expect,vi} from 'vitest';
import {tabActionDelivery} from '../apps/desktop/ui/tab-action-delivery.js';
it('only consumes live same-session action once and does not execute after cancellation',async()=>{
 let session='s';const request=vi.fn(async(input:any)=>input.type==='preview.action.claim'?{tabAction:{tab:{id:'x',kind:'new' as const,title:'New',active:false},action:'close' as const}}:{actionStatus:'closed'});
 const handler=vi.fn(async(_d:any,execute:any)=>{await execute();});const delivery=tabActionDelivery(()=>session,request,()=>handler),notice={type:'preview.action' as const,sessionId:'s',ticket:'t'};
 await delivery.deliver(notice);await delivery.deliver(notice);expect(handler).toHaveBeenCalledOnce();expect(request).toHaveBeenLastCalledWith({...notice,type:'preview.action.complete',applied:true});
 session='other';await delivery.deliver({...notice,ticket:'other'});expect(handler).toHaveBeenCalledOnce();delivery.dispose();
});
it('cancels a claimed request before execution and does not replay after navigation',async()=>{
 let resolve!:()=>void;const wait=new Promise<void>(r=>resolve=r),request=vi.fn(async(input:any)=>{if(input.type==='preview.action.claim'){await wait;return {tabAction:{tab:{id:'x',kind:'new' as const,title:'New',active:false},action:'close' as const}};}return{};});
 const handler=vi.fn(),delivery=tabActionDelivery(()=> 's',request,()=>handler),notice={type:'preview.action' as const,sessionId:'s',ticket:'t'};
 const pending=delivery.deliver(notice);await delivery.deliver({...notice,type:'preview.action.cancel'});resolve();await pending;expect(handler).not.toHaveBeenCalled();expect(request.mock.calls.some(([r])=>r.type==='preview.action.execute')).toBe(false);delivery.dispose();
});
