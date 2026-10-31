import {it,expect,vi} from 'vitest';
import type {Notice,PreviewTabMetadata} from '../packages/core/src/index.js';
import {PreviewTabs} from '../apps/host/src/preview-tabs.js';
import {pageReadTool} from '../apps/host/src/page-tool.js';
const signal=new AbortController().signal;
it('lists all real types in UI order with stable opaque IDs, safe URLs and validated file paths on Web',async()=>{
 let rows:PreviewTabMetadata[]=[{id:'web:https://example.com/?token=secret',kind:'web',url:'https://example.com/?token=secret#password',title:'Article',active:false},{id:'file:/private',kind:'file',title:'Notes',path:'notes.txt',active:true},{id:'new',kind:'new',title:'New',active:false},{id:'root',kind:'workspace',title:'Directory',active:false}];
 const notices:Notice[]=[];const broker=new PreviewTabs(n=>{notices.push(n);if(n.type==='preview.tabs'){broker.claim('s',n.ticket);broker.complete('s',n.ticket,rows);}},()=> 's');
 const validate=vi.fn(async()=>{}),tool=broker.tool('s',validate);
 const first=JSON.parse(await tool.execute({},signal)),second=JSON.parse(await tool.execute({},signal));
 expect(first.tabs.map((t:any)=>t.kind)).toEqual(['web','file','new','workspace']);expect(first.tabs[1]).toMatchObject({active:true,path:'notes.txt'});expect(first.tabs.map((t:any)=>t.tabId)).toEqual(second.tabs.map((t:any)=>t.tabId));
 expect(JSON.stringify(first)).not.toMatch(/secret|password|file:\/private|web:https/);expect(first.tabs[0]).toMatchObject({url:'https://example.com/',readable:false});expect(validate).toHaveBeenCalledWith('notes.txt');
 await expect(pageReadTool('s',()=> 's',undefined,broker).prepare!({tabId:first.tabs[0].tabId},signal)).rejects.toThrow('仅支持桌面');
 rows=[{...rows[1],path:'../outside'}];await expect(broker.tool('s',async()=>{throw new Error('unauthorized path');}).execute({},signal)).rejects.toThrow('unauthorized');
 expect(()=>broker.complete('s',(notices[0] as any).ticket,[])).toThrow('失效');
});
it('rejects closed, navigated, expired and cross-session IDs without a read, supports nonactive tabs',async()=>{
 let selected='s',rows:PreviewTabMetadata[]=[{id:'one',kind:'web',title:'One',url:'https://one.test/',active:true},{id:'two',kind:'web',title:'Two',url:'https://two.test/',active:false}];
 const desktop={call:vi.fn(async()=>({pages:rows.map((r,i)=>({id:r.id,ref:`native-${r.id}`,version:i,url:r.url,title:r.title}))}))};
 const broker=new PreviewTabs(n=>{if(n.type==='preview.tabs'){broker.claim(selected,n.ticket);broker.complete(selected,n.ticket,rows);}},()=>selected,desktop);
 const result=JSON.parse(await broker.tool('s',async()=>{}).execute({},signal)),id=result.tabs[1].tabId;
 expect(await broker.resolve('s',id,signal)).toEqual({ref:'native-two',version:1});
 rows[1]={...rows[1],url:'https://two.test/changed'};await expect(broker.resolve('s',id,signal)).rejects.toThrow('导航');
 rows.pop();await expect(broker.resolve('s',id,signal)).rejects.toThrow('关闭');
 selected='other';await expect(broker.resolve('s',id,signal)).rejects.toThrow('切回');await expect(broker.resolve('other',id,signal)).rejects.toThrow('不属于');
 selected='s';const now=vi.spyOn(Date,'now').mockReturnValue(Date.now()+300001);await expect(broker.resolve('s',id,signal)).rejects.toThrow('过期');now.mockRestore();
 expect(desktop.call).toHaveBeenCalledTimes(1);
});
it('metadata delivery requires a live one-use claim, cancels and times out without replay',async()=>{
 let notice:Extract<Notice,{type:'preview.tabs'}>|undefined;const broker=new PreviewTabs(n=>{if(n.type==='preview.tabs')notice=n;},()=> 's',undefined,10);
 const controller=new AbortController(),query=broker.query('s',controller.signal);const ticket=notice!.ticket;
 expect(()=>broker.complete('s',ticket,[])).toThrow('失效');expect(()=>broker.claim('other',ticket)).toThrow('切回');broker.claim('s',ticket);expect(()=>broker.claim('s',ticket)).toThrow('失效');
 controller.abort();await expect(query).rejects.toThrow('取消');expect(()=>broker.complete('s',ticket,[])).toThrow('失效');
 await expect(broker.query('s',signal)).rejects.toThrow('未响应');
 const restarted=new PreviewTabs(()=>{},()=> 's');expect(()=>restarted.claim('s',ticket)).toThrow('失效');
});
it('does not reuse an old model ID after a native page is closed and recreated with the same UI key',async()=>{
 let ref='original';const desktop={call:async()=>({pages:[{id:'same-key',ref,version:1,url:'https://example.com/',title:'Page'}]})};
 const broker=new PreviewTabs(n=>{if(n.type==='preview.tabs'){broker.claim('s',n.ticket);broker.complete('s',n.ticket,[{id:'same-key',kind:'web',title:'Page',url:'https://example.com/',active:true}]);}},()=> 's',desktop);
 const tool=broker.tool('s',async()=>{}),first=JSON.parse(await tool.execute({},signal));ref='recreated';const second=JSON.parse(await tool.execute({},signal));
 expect(first.tabs[0].tabId).not.toBe(second.tabs[0].tabId);await expect(broker.resolve('s',first.tabs[0].tabId,signal)).rejects.toThrow('list_preview_tabs');
});
