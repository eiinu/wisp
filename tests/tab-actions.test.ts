import {it,expect,vi} from 'vitest';
import {PreviewTabs} from '../apps/host/src/preview-tabs.js';
import {TabActions} from '../apps/host/src/tab-actions.js';
import type {Notice,PreviewTabMetadata} from '../packages/core/src/index.js';
const signal=new AbortController().signal;
function setup(timeout=1000){
 let selected='s',rows:PreviewTabMetadata[]=[{id:'web',kind:'web',url:'https://example.com/?secret=x',title:'Web',active:false},{id:'file',kind:'file',path:'notes.txt',title:'File',active:true},{id:'dir',kind:'workspace',path:'sub',title:'Directory',active:false},{id:'new',kind:'new',title:'New',active:false}];
 const notices:Notice[]=[];const desktop={call:vi.fn(async(operation:string)=>operation==='page.list'?{pages:[{id:'web',ref:'native',version:3,url:rows[0].url}]}:{status:'navigation_requested'})};
 const tabs=new PreviewTabs(n=>{if(n.type==='preview.tabs'){tabs.claim(selected,n.ticket);tabs.complete(selected,n.ticket,rows);}},()=>selected,desktop);
 const actions=new TabActions(tabs,n=>notices.push(n),desktop,timeout),tool=actions.tool('s');
 return {tool,actions,desktop,rows,notices,setSelected:(s:string)=>{selected=s;},list:async()=>JSON.parse(await tabs.tool('s',async()=>{}).execute({},signal)).tabs,ticket:()=>{const n=notices.findLast(n=>n.type==='preview.action');if(!n||n.type!=='preview.action')throw Error('no ticket');return n.ticket;}};
}
it('captures identity before approval; refreshes native nonactive page exactly once without claiming load',async()=>{
 const s=setup(),list=await s.list(),prepared=await s.tool.prepare!({tabId:list[0].tabId,action:'reload'},signal);
 expect(s.tool.requiresApproval).toBe(true);expect(prepared.description).not.toContain('secret=x');
 const running=prepared.execute(signal);await vi.waitFor(()=>expect(s.notices.some(n=>n.type==='preview.action')).toBe(true));const ticket=s.ticket();
 expect(()=>s.actions.claim('other',ticket)).toThrow();expect(s.actions.claim('s',ticket).tabAction?.tab.id).toBe('web');expect(()=>s.actions.claim('s',ticket)).toThrow();
 expect(await s.actions.execute('s',ticket,async()=>{throw Error('unused');})).toMatchObject({actionStatus:'navigation_requested'});
 await expect(s.actions.execute('s',ticket,async()=>{throw Error('unused');})).rejects.toThrow('已执行');
 s.actions.complete('s',ticket,true);expect(JSON.parse(await running)).toMatchObject({status:'navigation_requested',contentRead:false});expect(s.desktop.call.mock.calls.filter(c=>c[0]==='page.action')).toHaveLength(1);
 expect(()=>s.actions.claim('s',ticket)).toThrow('失效');
});
it('reloads authorized file/directory with Host data only for UI, and rechecks permission at execution',async()=>{
 const s=setup(),list=await s.list();
 for(const index of [1,2]){
  const p=await s.tool.prepare!({tabId:list[index].tabId,action:'reload'},signal);const running=p.execute(signal);await vi.waitFor(()=>expect(s.notices.filter(n=>n.type==='preview.action')).toHaveLength(index));const ticket=s.ticket();s.actions.claim('s',ticket);
  const read=vi.fn(async()=>({path:'notes.txt',kind:'text',text:'private content',size:15})),dir=vi.fn(async()=>[]);
  const result=await s.actions.execute('s',ticket,async()=>({read,list:dir}) as any);expect(result.actionStatus).toBe('refreshed');if(index===1)expect(read).toHaveBeenCalledWith('notes.txt');else expect(dir).toHaveBeenCalledWith('sub');
  s.actions.complete('s',ticket,true);expect(await running).not.toContain('private content');
 }
 const p=await s.tool.prepare!({tabId:list[1].tabId,action:'reload'},signal),running=p.execute(signal);const failure=expect(running).rejects.toThrow('已撤销');await vi.waitFor(()=>expect(s.notices.filter(n=>n.type==='preview.action')).toHaveLength(3));const ticket=s.ticket();s.actions.claim('s',ticket);
 await expect(s.actions.execute('s',ticket,async()=>{throw Error('授权已撤销');})).rejects.toThrow('已撤销');await failure;
});
it('rejects wrong types, unknown IDs, changed approvals, session switches, cancellation and restart replay',async()=>{
 const s=setup(),list=await s.list();
 for(const args of [{tabId:list[1].tabId,action:'back'},{tabId:list[3].tabId,action:'reload'},{tabId:'missing',action:'close'},{tabId:list[0].tabId,action:'script'},{tabId:list[0].tabId,action:'close',url:'evil'}])await expect(s.tool.prepare!(args,signal)).rejects.toThrow();
 const p=await s.tool.prepare!({tabId:list[0].tabId,action:'close'},signal);s.rows[0].url+='changed';await expect(p.execute(signal)).rejects.toThrow('变化');
 const close=await s.tool.prepare!({tabId:list[1].tabId,action:'close'},signal);s.setSelected('other');await expect(close.execute(signal)).rejects.toThrow('切回');s.setSelected('s');
 const c=new AbortController(),running=close.execute(c.signal),failure=expect(running).rejects.toThrow('取消');await vi.waitFor(()=>expect(s.notices.some(n=>n.type==='preview.action')).toBe(true));const ticket=s.ticket();s.actions.claim('s',ticket);c.abort();await failure;
 await expect(s.actions.execute('s',ticket,async()=>{throw Error('unused');})).rejects.toThrow('失效');expect(s.desktop.call.mock.calls.some(c=>c[0]==='page.action')).toBe(false);
});
it('does not treat missing UI acknowledgement as success or retry on timeout',async()=>{
 const s=setup(10),list=await s.list(),p=await s.tool.prepare!({tabId:list[3].tabId,action:'close'},signal);await expect(p.execute(signal)).rejects.toThrow('超时');expect(()=>s.actions.claim('s',s.ticket())).toThrow('失效');
});
