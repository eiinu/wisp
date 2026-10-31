// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BrowserPanel } from './browser-panel.js';
import { LinkConfirmationProvider } from './link-confirmation.js';
let container:HTMLDivElement, root:Root;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});container=document.createElement('div');document.body.append(container);root=createRoot(container);vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({x:500,y:100,width:400,height:500} as DOMRect);});
afterEach(async()=>{await act(()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('hides the native view for dialogs, closes removed tabs and uses actual navigation state',async()=>{
 const command=vi.fn(async()=>({pages:[{id:'a',url:'https://example.com/final',title:'Final',loading:false,back:true,forward:false}],downloads:[]}));const browser={command,subscribe:vi.fn(()=>()=>{})};
 const props={state:{tabs:[{kind:'web' as const,id:'a',url:'https://example.com',title:'Example'}],activeId:'a'},dispatch:vi.fn(),visible:true,blocked:false,close:vi.fn(),connected:false,active:false,request:vi.fn(async()=>({})),chooseWorkspace:vi.fn(),browser};
 await act(()=>root.render(<LinkConfirmationProvider onOpen={()=>{}}><BrowserPanel {...props}/></LinkConfirmationProvider>));
 expect(command).toHaveBeenCalledWith({type:'open',id:'a',url:'https://example.com'});expect((container.querySelector('[aria-label=地址栏]') as HTMLInputElement).value).toBe('https://example.com/final');expect((container.querySelector('[aria-label=后退]') as HTMLButtonElement).disabled).toBe(false);
 await act(()=>root.render(<LinkConfirmationProvider onOpen={()=>{}}><BrowserPanel {...props} blocked/></LinkConfirmationProvider>));expect(command).toHaveBeenLastCalledWith({type:'layout'});
 await act(()=>root.render(<LinkConfirmationProvider onOpen={()=>{}}><BrowserPanel {...props} state={{tabs:[]}}/></LinkConfirmationProvider>));expect(command).toHaveBeenCalledWith({type:'close',id:'a'});
});
it('labels a Web new tab by the entered hostname and updates it on subsequent navigation',async()=>{
 const props={state:{tabs:[{kind:'web' as const,id:'new',url:'',title:'新网页'}],activeId:'new'},dispatch:vi.fn(),visible:true,blocked:false,close:vi.fn(),connected:false,active:false,request:vi.fn(async()=>({})),chooseWorkspace:vi.fn()};
 await act(()=>root.render(<BrowserPanel {...props}/>));
 expect(container.querySelector('[role=tab]')?.textContent).toContain('新网页');
 for (const url of ['https://example.com/','https://example.org/next']) {
   const address=container.querySelector<HTMLInputElement>('[aria-label=地址栏]')!;
   await act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(address,url);address.dispatchEvent(new Event('input',{bubbles:true}));});
   await act(()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
   const hostname=new URL(url).hostname;
   expect(container.querySelector('[role=tab]')?.textContent).toBe(hostname);
   expect(container.querySelector('[role=tab]')?.getAttribute('title')).toBe(hostname);
   expect(container.querySelector(`[aria-label="关闭 ${hostname}"]`)).not.toBeNull();
   expect(container.querySelector('iframe')?.getAttribute('src')).toBe(url);
 }
});
it('keeps new-tab outside the scroll strip and reveals selected tabs in either direction',async()=>{
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
   if(this.classList.contains('browser-tabs'))return {left:0,right:180,width:180} as DOMRect;
   const text=this.querySelector('[role=tab]')?.textContent;
   return {left:text==='Last'?400:-100,right:text==='Last'?530:30,width:130} as DOMRect;
 });
 const tabs=[{kind:'web' as const,id:'first',url:'',title:'First'},{kind:'web' as const,id:'last',url:'',title:'Last'}];
 const dispatch=vi.fn();const props={dispatch,visible:true,blocked:false,close:vi.fn(),connected:false,active:false,request:vi.fn(async()=>({})),chooseWorkspace:vi.fn()};
 await act(()=>root.render(<BrowserPanel {...props} state={{tabs,activeId:'last'}}/>));
 const list=container.querySelector<HTMLElement>('[role=tablist]')!;
 expect(list.scrollLeft).toBe(350);
 const add=container.querySelector<HTMLButtonElement>('[aria-label=新标签页]')!;
 expect(list.contains(add)).toBe(false);await act(()=>add.click());expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({type:'open',target:{kind:'web',url:''}}));
 await act(()=>root.render(<BrowserPanel {...props} state={{tabs,activeId:'first'}}/>));
 expect(list.scrollLeft).toBe(250);
 await act(()=>container.querySelector('[role=tab]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})));
 expect(dispatch).toHaveBeenLastCalledWith({type:'select',id:'last'});
 expect(document.activeElement?.textContent).toBe('Last');
});

it('reports all visible tab types and live Web address changes through the metadata reader',async()=>{
 let read:()=>any[]=()=>[];const props={state:{tabs:[{kind:'workspace' as const,id:'root',title:'Directory'},{kind:'file' as const,id:'file',title:'Note',sessionId:'s',workspace:'/work',path:'note.md'},{kind:'web' as const,id:'new',url:'',title:'New'}],activeId:'new'},dispatch:vi.fn(),visible:true,blocked:false,sessionId:'s',close:vi.fn(),connected:false,active:false,request:vi.fn(async()=>({})),chooseWorkspace:vi.fn(),registerTabs:(reader:()=>any[])=>{read=reader;}};
 await act(()=>root.render(<BrowserPanel {...props}/>));expect(read().map(t=>t.kind)).toEqual(['workspace','file','new']);expect(read()[1].path).toBe('note.md');expect(read()[2].active).toBe(true);
 const address=container.querySelector<HTMLInputElement>('[aria-label=地址栏]')!;
 await act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(address,'https://example.org/article');address.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(read()[2]).toMatchObject({kind:'web',url:'https://example.org/article',revision:1});
});
it('refreshes a nonactive file in place, preserves active selection and refuses to discard edits',async()=>{
 let read:()=>any[]=()=>[],handler:import('./tab-action-delivery.js').TabActionHandler|undefined;
 const dispatch=vi.fn(),request=vi.fn(async(input:any)=>input.type==='files.read'?{file:{kind:'text' as const,path:input.path,text:'old',size:3}}:{entries:[{name:'sub',path:'sub',kind:'directory' as const,size:0}]});
 const props={sessionId:'s',workspace:'/work',state:{tabs:[{id:'f',kind:'file' as const,path:'note.txt',sessionId:'s',workspace:'/work',title:'Note'},{id:'d',kind:'workspace' as const,title:'Directory'}],activeId:'d'},dispatch,visible:true,blocked:false,close:vi.fn(),connected:true,active:false,request,chooseWorkspace:vi.fn(),registerTabs:(r:()=>any[])=>{read=r;},registerAction:(h:typeof handler)=>{handler=h;}};
 await act(()=>root.render(<BrowserPanel {...props}/>));const expected=read().find(t=>t.id==='f');const execute=vi.fn(async()=>({actionStatus:'refreshed',file:{kind:'text' as const,path:'note.txt',text:'new text',size:8}}));
 await act(()=>handler!({tab:expected,action:'reload'},execute,new AbortController().signal));expect(container.querySelector('.plain-text')?.textContent).toBe('new text');expect(dispatch).not.toHaveBeenCalled();
 await act(()=>root.render(<BrowserPanel {...props} state={{...props.state,activeId:'f'}}/>));
 const edit=Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='编辑')!;await act(()=>edit.click());const dirty=read().find(t=>t.id==='f');
 await expect(handler!({tab:dirty,action:'close'},execute,new AbortController().signal)).rejects.toThrow('未保存');expect(execute).toHaveBeenCalledOnce();expect(container.querySelector('.file-editor')).not.toBeNull();
});
it('tracks the actual current directory and discards results after a session switch',async()=>{
 let read:()=>any[]=()=>[],handler:import('./tab-action-delivery.js').TabActionHandler|undefined;
 const dispatch=vi.fn(),request=vi.fn(async()=>({entries:[{name:'sub',path:'sub',kind:'directory' as const,size:0}]}));
 const props={sessionId:'s',workspace:'/work',state:{tabs:[{id:'d',kind:'workspace' as const,title:'Directory'}],activeId:'d'},dispatch,visible:true,blocked:false,close:vi.fn(),connected:true,active:false,request,chooseWorkspace:vi.fn(),registerTabs:(r:()=>any[])=>{read=r;},registerAction:(h:typeof handler)=>{handler=h;}};
 await act(()=>root.render(<BrowserPanel {...props}/>));const initial=read()[0];await act(()=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent?.includes('sub'))!.click());expect(read()[0].path).toBe('sub');expect(read()[0].revision).not.toBe(initial.revision);
 const execute=vi.fn(async()=>({actionStatus:'refreshed',entries:[]}));await expect(handler!({tab:initial,action:'reload'},execute,new AbortController().signal)).rejects.toThrow('变化');expect(execute).not.toHaveBeenCalled();
 let resolve!:(result:any)=>void;const pending=handler!({tab:read()[0],action:'reload'},()=>new Promise(r=>resolve=r),new AbortController().signal),failure=expect(pending).rejects.toThrow('变化');
 await act(()=>root.render(<BrowserPanel {...props} sessionId="other"/>));await act(async()=>resolve({actionStatus:'refreshed',entries:[]}));await failure;expect(dispatch).not.toHaveBeenCalled();
});
