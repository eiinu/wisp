import {it,expect,vi} from 'vitest';
import {pageReadTool} from '../apps/host/src/page-tool.js';
import {PreviewTabs} from '../apps/host/src/preview-tabs.js';
import type {PreviewTabMetadata} from '../packages/core/src/index.js';
it('requires a listed explicit webpage, never reads before approval and rejects other sessions',async()=>{
 let selected='a';const signal=new AbortController().signal;
 const call=vi.fn(async(op:string)=>op==='page.list'?{pages:[{id:'internal',ref:'native-id',version:5,url:'https://example.com/',title:'Title',loading:false}]}:op==='page.prepare'?{ticket:'private',url:'https://example.com/',title:'Title'}:{text:'untrusted article'});
 const rows:PreviewTabMetadata[]=[{id:'internal',kind:'web',url:'https://example.com/',title:'Title',active:false},{id:'file',kind:'file',path:'a.txt',title:'File',active:true}];
 const tabs=new PreviewTabs(notice=>{if(notice.type==='preview.tabs'){tabs.claim('a',notice.ticket);tabs.complete('a',notice.ticket,rows);}},()=>selected,{call});
 const result=JSON.parse(await tabs.tool('a',async()=>{}).execute({},signal));
 const tool=pageReadTool('a',()=>selected,{call},tabs),args={tabId:result.tabs[0].tabId};
 expect(()=>tool.validate!({})).toThrow();expect(()=>tool.validate!({script:'evil'})).toThrow();
 await expect(tool.prepare!({tabId:result.tabs[1].tabId},signal)).rejects.toThrow('不是网页');
 await expect(tool.prepare!({tabId:'unlisted'},signal)).rejects.toThrow('list_preview_tabs');
 const prepared=await tool.prepare!(args,signal);expect(call).toHaveBeenLastCalledWith('page.prepare',{sessionId:'a',tabId:'native-id',version:5},signal);expect(prepared.description).toContain('发送给当前模型');
 expect(JSON.parse(await prepared.execute(signal))).toMatchObject({source:'untrusted_webpage',text:'untrusted article',tabId:args.tabId});
 selected='b';await expect(prepared.execute(signal)).rejects.toThrow('切回');
});
