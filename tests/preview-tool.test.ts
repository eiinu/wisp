import {expect,it,vi} from 'vitest';
import {PreviewRequests,previewUrl} from '../apps/host/src/preview.js';
import type {PreviewNotice} from '../packages/core/src/index.js';
it('delivers only once to the selected session and reports acceptance without claiming page content',async()=>{
 let notice:PreviewNotice|undefined;const requests=new PreviewRequests(n=>notice=n,()=> 'one');
 const result=requests.tool('one').execute({url:'https://example.com/'},new AbortController().signal);
 expect(requests.tool('one').requiresApproval).toBe(true);
 expect(()=>requests.claim('two',notice!.ticket)).toThrow();
 expect(requests.claim('one',notice!.ticket).url).toBe('https://example.com/');
 expect(()=>requests.claim('one',notice!.ticket)).toThrow();
 requests.complete('one',notice!.ticket,true);expect(JSON.parse(await result)).toMatchObject({status:'open_request_accepted',contentRead:false});
 expect(()=>requests.complete('one',notice!.ticket,true)).toThrow();
});
it('invalidates cancelled, timed out, switched and restored tickets',async()=>{
 let notice:PreviewNotice|undefined,selected='one';const requests=new PreviewRequests(n=>notice=n,()=>selected,10);
 const control=new AbortController(),result=requests.tool('one').execute({url:'https://example.com'},control.signal);control.abort();
 await expect(result).rejects.toThrow('取消');expect(()=>requests.claim('one',notice!.ticket)).toThrow();
 const expired=requests.tool('one').execute({url:'https://example.com'},new AbortController().signal);
 await expect(expired).rejects.toThrow('未确认');expect(()=>requests.claim('one',notice!.ticket)).toThrow();
 selected='two';await expect(requests.tool('one').execute({url:'https://example.com'},new AbortController().signal)).rejects.toThrow('切回');
 expect(()=>new PreviewRequests(()=>{},()=> 'one').claim('one',notice!.ticket)).toThrow();
});
it('rejects unsafe URLs and unexpected arguments before approval',()=>{
 for(const url of ['javascript:alert(1)','file:///tmp/a','data:text/html,x','https://user:pass@example.com','/relative','https://exa\nmple.com'])expect(()=>previewUrl({url})).toThrow();
 expect(()=>previewUrl({url:'https://example.com',script:'evil'})).toThrow();
});
it('cancellation after claim invalidates completion and a UI rejection is not reported as acceptance',async()=>{
 let notice:PreviewNotice|undefined;const requests=new PreviewRequests(n=>notice=n,()=> 'one');
 const control=new AbortController();const result=requests.tool('one').execute({url:'https://example.com'},control.signal);
 requests.claim('one',notice!.ticket);control.abort();await expect(result).rejects.toThrow('取消');
 expect(()=>requests.complete('one',notice!.ticket,true)).toThrow();
 const rejected=requests.tool('one').execute({url:'https://example.com'},new AbortController().signal);
 requests.claim('one',notice!.ticket);requests.complete('one',notice!.ticket,false);
 await expect(rejected).rejects.toThrow('无法接收');
});
