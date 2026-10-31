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
