// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {ProjectSidebar} from './project-sidebar.js';
let root:Root, container:HTMLDivElement;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(()=>root.unmount());container.remove();});
const project={id:'p',name:'Project',workspace:'/fixture',collapsed:false,createdAt:''};
const props=()=>({projects:[project],sessions:[{id:'s',projectId:'p',title:'Inside',createdAt:'2026-10-31',updatedAt:'2026-10-31'},{id:'other',title:'Outside',createdAt:'2026-10-31',updatedAt:'2026-10-31'}],selected:'other',connected:true,request:vi.fn(async(_input:unknown):Promise<any>=>({sessionId:'new'})),select:vi.fn(),openDirectory:vi.fn(),onDialogChange:vi.fn()});
const get=(label:string)=>document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
const text=(label:string)=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent===label)!;
async function value(label:string,value:string){await act(()=>{const el=document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});}
it('cancels project creation without authorization and creates once after native directory selection',async()=>{
 const p=props(),picker=vi.fn(async()=>'/fixture/My project');await act(()=>root.render(<ProjectSidebar {...p} chooseDirectory={picker}/>));
 await act(()=>get('新建项目').click());await act(()=>text('取消').click());expect(p.request).not.toHaveBeenCalled();
 await act(()=>get('新建项目').click());await act(()=>text('选择文件夹…').click());
 expect(document.querySelector<HTMLInputElement>('[aria-label=项目名称]')?.value).toBe('My project');
 let release!:(r:any)=>void;p.request.mockImplementationOnce(()=>new Promise(r=>{release=r;}));
 await act(()=>{text('创建并授权项目').click();document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 expect(p.request).toHaveBeenCalledExactlyOnceWith({type:'project.create',name:'My project',path:'/fixture/My project',confirmed:true});
 await act(()=>release({projectId:'created'}));expect(document.querySelector('[role=dialog]')).toBeNull();
});
it('groups sessions, persists collapse, opens the matching directory and prevents duplicate new conversations',async()=>{
 const p=props();await act(()=>root.render(<ProjectSidebar {...p}/>));
 expect(container.querySelector('.project-children')?.textContent).toContain('Inside');expect(container.querySelector('.project-children')?.textContent).not.toContain('Outside');
 await act(()=>text('项目目录').click());expect(p.openDirectory).toHaveBeenCalledWith('s');
 await act(()=>get('收起项目 Project').click());expect(p.request).toHaveBeenLastCalledWith({type:'project.collapse',projectId:'p',collapsed:true});
 await act(()=>root.render(<ProjectSidebar {...p} projects={[{...project,collapsed:true}]}/>));expect(container.querySelector('.project-children')?.hasAttribute('hidden')).toBe(true);
 await act(()=>root.render(<ProjectSidebar {...p}/>));
 let release!:(r:any)=>void;p.request.mockImplementationOnce(()=>new Promise(r=>{release=r;}));
 await act(()=>{text('新对话 · Project').click();text('新对话 · Project').click();});
 expect(p.request.mock.calls.filter(([r])=>(r as any).type==='session.create')).toHaveLength(1);
 await act(()=>release({sessionId:'new'}));expect(p.select).toHaveBeenCalledWith('new');
});
it('renames without changing the root and explains Web authorization',async()=>{
 const p=props();await act(()=>root.render(<ProjectSidebar {...p}/>));
 await act(()=>get('重命名项目 Project').click());await value('项目名称','Renamed');await act(()=>text('保存名称').click());
 expect(p.request).toHaveBeenLastCalledWith({type:'project.rename',projectId:'p',name:'Renamed'});
 await act(()=>get('新建项目').click());expect(document.body.textContent).toContain('Web 无系统目录选择器');
 await act(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(document.querySelector('[role=dialog]')).toBeNull();
});
it('does not grant anything when the native picker is cancelled',async()=>{
 const p=props();await act(()=>root.render(<ProjectSidebar {...p} chooseDirectory={async()=>undefined}/>));
 await act(()=>get('新建项目').click());await act(()=>text('选择文件夹…').click());
 expect(document.querySelector<HTMLInputElement>('[aria-label=项目文件夹]')?.value).toBe('');
 expect(text('创建并授权项目').disabled).toBe(true);expect(p.request).not.toHaveBeenCalled();
 await act(()=>text('取消').click());expect(document.querySelector('[role=dialog]')).toBeNull();
});
