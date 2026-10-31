import {it,expect,vi} from 'vitest';
import {pageReadTool} from '../apps/host/src/page-tool.js';
import {PreviewTabs} from '../apps/host/src/preview-tabs.js';
import type {PreviewTabMetadata} from '../packages/core/src/index.js';
it('requires a listed explicit webpage, reads without approval and rejects other sessions',async()=>{
 let selected='a';const signal=new AbortController().signal;
 const call=vi.fn(async(op:string)=>op==='page.list'?{pages:[{id:'internal',ref:'native-id',version:5,url:'https://example.com/',title:'Title',loading:false}]}:op==='page.bind'?{ticket:'private',url:'https://example.com/',title:'Title'}:{text:'untrusted article'});
 const rows:PreviewTabMetadata[]=[{id:'internal',kind:'web',url:'https://example.com/',title:'Title',active:false},{id:'file',kind:'file',path:'a.txt',title:'File',active:true}];
 const tabs=new PreviewTabs(notice=>{if(notice.type==='preview.tabs'){tabs.claim('a',notice.ticket);tabs.complete('a',notice.ticket,rows);}},()=>selected,{call});
 const result=JSON.parse(await tabs.tool('a',async()=>{}).execute({},signal));
 const tool=pageReadTool('a',()=>selected,{call},tabs),args={tabId:result.tabs[0].tabId};
 expect(()=>tool.validate!({})).toThrow();expect(()=>tool.validate!({script:'evil'})).toThrow();
 await expect(tool.execute({tabId:result.tabs[1].tabId},signal)).rejects.toThrow('不是网页');
 await expect(tool.execute({tabId:'unlisted'},signal)).rejects.toThrow('list_preview_tabs');
 expect(tool.requiresApproval).toBe(false);expect(tool.prepare).toBeUndefined();
 expect(JSON.parse(await tool.execute(args,signal))).toMatchObject({source:'untrusted_webpage',text:'untrusted article',tabId:args.tabId});
 expect(call).toHaveBeenCalledWith('page.bind',{sessionId:'a',tabId:'native-id',version:5},signal);
 selected='b';await expect(tool.execute(args,signal)).rejects.toThrow();
});
