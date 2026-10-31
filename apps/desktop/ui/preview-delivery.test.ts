import {expect,it,vi} from 'vitest';
import {previewDelivery} from './preview-delivery.js';
import type {Request,Result} from '@wisp/core';
const notice={type:'preview.open' as const,sessionId:'one',ticket:'ticket'};
it('opens an approved delivery only once and completes with acceptance',async()=>{
 const open=vi.fn(),request=vi.fn(async(input:Request):Promise<Result>=>input.type==='preview.claim'?{preview:{ticket:'ticket',url:'https://example.com/'}}:{});
 const consume=previewDelivery(()=> 'one',request,open);
 await consume(notice);await consume(notice);expect(open).toHaveBeenCalledTimes(1);
 expect(request).toHaveBeenLastCalledWith({type:'preview.complete',sessionId:'one',ticket:'ticket',accepted:true});
});
it('does not open another session or a request that becomes stale during the claim',async()=>{
 const open=vi.fn();let selected='two';
 const request=vi.fn(async():Promise<Result>=>{selected='two';return{preview:{ticket:'ticket',url:'https://example.com'}};});
 const consume=previewDelivery(()=>selected,request,open);
 await consume(notice);expect(request).not.toHaveBeenCalled();selected='one';await consume(notice);
 expect(open).not.toHaveBeenCalled();expect(request).toHaveBeenLastCalledWith({type:'preview.complete',sessionId:'one',ticket:'ticket',accepted:false});
});
it('does not open expired or unsafe deliveries',async()=>{
 const open=vi.fn();await previewDelivery(()=> 'one',async()=>{throw new Error('expired');},open)(notice);
 await previewDelivery(()=> 'one',async()=>({preview:{ticket:'ticket',url:'file:///etc/passwd'}}),open)(notice);
 expect(open).not.toHaveBeenCalled();
});
