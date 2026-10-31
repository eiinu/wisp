import {it,expect,vi} from 'vitest';
import {tabListDelivery} from '../apps/desktop/ui/tab-list-delivery.js';
it('only sends metadata once for live selected-session tickets',async()=>{
 let selected='s';const read=vi.fn(()=>[{id:'a',kind:'new' as const,title:'New',active:true}]),request=vi.fn(async()=>({}));
 const deliver=tabListDelivery(()=>selected,request,read),notice={type:'preview.tabs' as const,sessionId:'s',ticket:'ticket'};
 await deliver({...notice,sessionId:'other'});expect(request).not.toHaveBeenCalled();
 await Promise.all([deliver(notice),deliver(notice)]);expect(read).toHaveBeenCalledTimes(1);expect(request).toHaveBeenCalledTimes(2);
 request.mockImplementation(async()=>{selected='other';return{};});await deliver({...notice,ticket:'next'});expect(read).toHaveBeenCalledTimes(1);
});
