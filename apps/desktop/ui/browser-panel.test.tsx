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
