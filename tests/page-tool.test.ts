import {it,expect,vi} from 'vitest';
import {pageReadTool} from '../apps/host/src/page-tool.js';
it('does not read content before approval and rejects Web, cross-session and arbitrary arguments',async()=>{
 let selected='a';const call=vi.fn(async(op:string)=>op==='page.prepare'?{ticket:'private',url:'https://example.com',title:'Title',tabId:'a'}:{text:'untrusted article'});
 const tool=pageReadTool('a',()=>selected,{call}),signal=new AbortController().signal;
 await tool.validate!({});const prepared=await tool.prepare!({},signal);expect(call).toHaveBeenCalledTimes(1);expect(prepared.description).toContain('发送给当前模型');
 expect(JSON.parse(await prepared.execute(signal))).toMatchObject({source:'untrusted_webpage',text:'untrusted article'});
 selected='b';await expect(prepared.execute(signal)).rejects.toThrow('切回');expect(()=>pageReadTool('a',()=> 'a').validate!({})).toThrow('仅支持桌面');expect(()=>tool.validate!({script:'evil'})).toThrow();
});
