// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {SplitWorkspace,splitWidths} from './split-workspace.js';
let root:Root,container:HTMLDivElement,width:number,measure:()=>void;
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true; localStorage.clear();width=1208;
 vi.stubGlobal('ResizeObserver',class {constructor(callback:()=>void){measure=callback;}observe(){}disconnect(){}});
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(()=>({width,left:210} as DOMRect));
 HTMLElement.prototype.setPointerCapture=vi.fn();HTMLElement.prototype.releasePointerCapture=vi.fn();HTMLElement.prototype.hasPointerCapture=()=>true;
 container=document.createElement('div');document.body.append(container);root=createRoot(container);
});
afterEach(async()=>{await act(()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
const render=()=>act(()=>root.render(<SplitWorkspace visible right={({dragging})=><span data-dragging={dragging}>preview</span>}><div>conversation</div></SplitWorkspace>));
async function pointer(type:string,x:number){await act(()=>{const event=new MouseEvent(type,{bubbles:true,button:0,clientX:x});Object.defineProperty(event,'pointerId',{value:7});container.querySelector('[role=separator]')!.dispatchEvent(event);});}
it('clamps only at 300px minimum per pane with no fixed right maximum',()=>{
 expect(splitWidths(2008,.15)).toEqual({narrow:false,left:300,right:1700});
 expect(splitWidths(2008,.99)).toEqual({narrow:false,left:1700,right:300});
 expect(splitWidths(608,.1)).toEqual({narrow:false,left:300,right:300});
 expect(splitWidths(607,.5).narrow).toBe(true);
});
it('supports keyboard resize, remembers preference and clamps after window resizing',async()=>{
 await render();const sep=container.querySelector('[role=separator]')!;
 await act(()=>sep.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})));expect(sep.getAttribute('aria-valuenow')).toBe('900');expect(localStorage.getItem('wisp.workspace-split-ratio')).toBe('0.75');
 width=708;await act(()=>measure());expect(sep.getAttribute('aria-valuenow')).toBe('400');
 width=600;await act(()=>measure());expect(container.querySelector('[role=separator]')).toBeNull();expect(container.querySelector('.split-primary')?.hasAttribute('hidden')).toBe(true);expect(container.querySelector('.split-secondary')?.hasAttribute('hidden')).toBe(false);
 width=1208;await act(()=>measure());expect(container.querySelector('[role=separator]')?.getAttribute('aria-valuenow')).toBe('900');
});
it('captures dragging, signals native view blocking and restores on pointer cancel',async()=>{
 await render();await pointer('pointerdown',810);expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledWith(7);expect(container.querySelector('[data-dragging]')?.getAttribute('data-dragging')).toBe('true');
 await pointer('pointermove',1110);expect(container.querySelector('[role=separator]')?.getAttribute('aria-valuenow')).toBe('900');
 await pointer('pointercancel',1110);expect(container.querySelector('[role=separator]')?.getAttribute('aria-valuenow')).toBe('600');expect(container.querySelector('[data-dragging]')?.getAttribute('data-dragging')).toBe('false');expect(HTMLElement.prototype.releasePointerCapture).toHaveBeenCalledWith(7);
 await pointer('pointerdown',810);await pointer('pointermove',610);await pointer('pointerup',610);expect(container.querySelector('[role=separator]')?.getAttribute('aria-valuenow')).toBe('400');
});
