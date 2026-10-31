import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
import { browserUrl } from '../apps/desktop/shared/browser.js';
const mocks = vi.hoisted(() => ({ views: [] as any[], remote: undefined as any, View: vi.fn(), partition: vi.fn() }));
vi.mock('electron', () => ({ WebContentsView: mocks.View, session: { fromPartition: mocks.partition } }));
import { createBrowser } from '../apps/desktop/src/browser.js';
beforeEach(() => {
  mocks.views.length = 0; vi.clearAllMocks();
  mocks.remote = Object.assign(new EventEmitter(), { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() }); mocks.partition.mockReturnValue(mocks.remote);
  mocks.View.mockImplementation(function(options) {
    const wc = Object.assign(new EventEmitter(), { isDestroyed: () => false, getURL: vi.fn(() => 'https://example.com/redirected'), getTitle: () => 'Remote title', isLoading: () => false,
      navigationHistory: { canGoBack: () => true, canGoForward: () => false, goBack: vi.fn(), goForward: vi.fn() }, setWindowOpenHandler: vi.fn(), loadURL: vi.fn(async () => {}), close: vi.fn(), reload: vi.fn() });
    const view = { webContents: wc, options, setVisible: vi.fn(), setBounds: vi.fn() }; mocks.views.push(view); return view;
  });
});
async function listed(controller:ReturnType<typeof createBrowser>,sessionId='s',id='a'){const result=await controller.pageOperation('page.list',{sessionId},new AbortController().signal) as any;const page=result.pages.find((p:any)=>p.id===id);return {sessionId,tabId:page?.ref,version:page?.version};}
function setup() {
  const window = Object.assign(new EventEmitter(), { contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }, webContents: { send: vi.fn() }, isDestroyed: () => false, getContentSize: () => [1000, 700] });
  return { window, controller: createBrowser(window as any) };
}
it('isolates remote pages, rejects unsafe navigation, reflects real history and closes resources', () => {
  const {window,controller} = setup();
  controller.command({type:'open',id:'a',url:'https://example.com'}); const view=mocks.views[0], wc=view.webContents;
  expect(view.options.webPreferences).toMatchObject({session:mocks.remote,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}); expect(view.options.webPreferences.preload).toBeUndefined();
  for (const url of ['file:///tmp/key','javascript:alert(1)','https://user:secret@example.com','data:text/html,hi']) {
    expect(browserUrl(url)).toBeUndefined(); expect(() => controller.command({type:'open',id:'x',url})).toThrow();
    const event={preventDefault:vi.fn()}; wc.emit('will-navigate',event,url); expect(event.preventDefault).toHaveBeenCalled();
  }
  wc.emit('did-navigate'); expect(controller.command({type:'snapshot'}).pages[0]).toMatchObject({url:'https://example.com/redirected',title:'Remote title',back:true,forward:false});
  controller.command({type:'back',id:'a'}); expect(wc.navigationHistory.goBack).toHaveBeenCalledOnce();
  controller.command({type:'layout',id:'a',bounds:{x:500,y:100,width:500,height:600}}); expect(view.setVisible).toHaveBeenLastCalledWith(true);
  window.emit('resize'); expect(view.setVisible).toHaveBeenLastCalledWith(false);
  expect(() => controller.command({type:'layout',id:'a',bounds:{x:-1,y:0,width:500,height:500}})).toThrow();
  const popup = wc.setWindowOpenHandler.mock.calls[0][0]; expect(popup({url:'https://example.org'})).toEqual({action:'deny'}); expect(window.webContents.send).toHaveBeenCalledWith('wisp:browser-open-request','https://example.org/');
  controller.command({type:'close',id:'a'}); expect(wc.close).toHaveBeenCalledWith({waitForBeforeUnload:false}); expect(wc.eventNames()).toHaveLength(0); expect(window.contentView.removeChildView).toHaveBeenCalledWith(view);
  controller.command({type:'open',id:'b',url:'https://example.org'});
  window.emit('close'); expect(mocks.views[1].webContents.close).toHaveBeenCalledOnce(); expect(mocks.remote.listenerCount('will-download')).toBe(0);
  expect(() => controller.command({type:'snapshot'})).toThrow('Browser unavailable');
});
it('reports download bytes from Electron, prompts for save and cancels without executing files', () => {
  const {controller}=setup(); controller.command({type:'open',id:'a',url:'https://example.com'});
  const item=Object.assign(new EventEmitter(),{getURL:()=> 'https://example.com/a.txt',getFilename:()=> 'a.txt',getTotalBytes:()=>100,getReceivedBytes:()=>41,setSaveDialogOptions:vi.fn(),cancel:vi.fn()});
  mocks.remote.emit('will-download',{preventDefault:vi.fn()},item,mocks.views[0].webContents);
  expect(item.setSaveDialogOptions).toHaveBeenCalled(); item.emit('updated',{},'progressing');
  let state=controller.command({type:'snapshot'}); expect(state.downloads[0]).toMatchObject({received:41,total:100,state:'progressing'});
  controller.command({type:'cancel-download',id:state.downloads[0].id}); expect(item.cancel).toHaveBeenCalledOnce(); item.emit('done',{},'cancelled');
  expect(controller.command({type:'snapshot'}).downloads[0].state).toBe('cancelled'); expect(item.listenerCount('updated')).toBe(0);
  const denied={preventDefault:vi.fn()}; mocks.remote.emit('will-download',denied,item,{}); expect(denied.preventDefault).toHaveBeenCalled(); controller.dispose();
});
it('page read binds session, tab and navigation version, consumes approval once and never reads before approval',async()=>{
 const {controller}=setup();controller.command({type:'context',sessionId:'s',id:'a'});controller.command({type:'open',id:'a',url:'https://example.com'});
 const wc=mocks.views[0].webContents;wc.executeJavaScriptInIsolatedWorld=vi.fn(async()=>({title:'Article',text:'visible article',links:[],truncated:false}));
 const signal=new AbortController().signal;
 const p=await controller.pageOperation('page.prepare',await listed(controller),signal);expect(p).toMatchObject({url:'https://example.com/redirected'});expect(wc.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
 expect(await controller.pageOperation('page.read',{sessionId:'s',ticket:p.ticket},signal)).toMatchObject({text:'visible article'});
 await expect(controller.pageOperation('page.read',{sessionId:'s',ticket:p.ticket},signal)).rejects.toThrow('过期');
 const stale=await controller.pageOperation('page.prepare',await listed(controller),signal);wc.emit('did-start-navigation',{},'https://example.com/changed',false,true);
 await expect(controller.pageOperation('page.read',{sessionId:'s',ticket:stale.ticket},signal)).rejects.toThrow('改变');
 const switched=await controller.pageOperation('page.prepare',await listed(controller),signal);controller.command({type:'context',sessionId:'other',id:'a'});
 await expect(controller.pageOperation('page.read',{sessionId:'s',ticket:switched.ticket},signal)).rejects.toThrow('当前会话');
 await expect(controller.pageOperation('page.prepare',{sessionId:'other',tabId:'a'},signal)).rejects.toThrow('没有');
 controller.command({type:'context',sessionId:'s',id:'a'});wc.isLoading=()=>true;
 await expect(controller.pageOperation('page.prepare',await listed(controller),signal)).rejects.toThrow('未加载');controller.dispose();
});
it('discards page results on navigation during extraction or cancellation',async()=>{
 const {controller}=setup();controller.command({type:'context',sessionId:'s',id:'a'});controller.command({type:'open',id:'a',url:'https://example.com'});
 const wc=mocks.views[0].webContents,signal=new AbortController().signal;
 wc.executeJavaScriptInIsolatedWorld=vi.fn(async()=>{wc.emit('did-start-navigation',{},'',false,true);return {text:'wrong page',links:[]};});
 const p=await controller.pageOperation('page.prepare',await listed(controller),signal);await expect(controller.pageOperation('page.read',{sessionId:'s',ticket:p.ticket},signal)).rejects.toThrow('结果已丢弃');
 const q=await controller.pageOperation('page.prepare',await listed(controller),signal),cancel=new AbortController();wc.executeJavaScriptInIsolatedWorld=vi.fn(()=>new Promise(()=>{}));
 const reading=controller.pageOperation('page.read',{sessionId:'s',ticket:q.ticket},cancel.signal);cancel.abort();await expect(reading).rejects.toThrow();controller.dispose();
});
it('lists only owned native pages and reads an explicitly listed nonactive page; stale list and close fail',async()=>{
 const {controller}=setup(),signal=new AbortController().signal;
 controller.command({type:'context',sessionId:'s',id:'a'});controller.command({type:'open',id:'a',url:'https://a.test/'});controller.command({type:'open',id:'b',url:'https://b.test/'});
 mocks.views[0].webContents.getURL.mockReturnValue('https://a.test/?token=secret');mocks.views[1].webContents.getURL.mockReturnValue('https://b.test/');
 mocks.views[0].webContents.executeJavaScriptInIsolatedWorld=vi.fn();mocks.views[1].webContents.executeJavaScriptInIsolatedWorld=vi.fn(async()=>({title:'B',text:'B article',links:[]}));
 const list=await controller.pageOperation('page.list',{sessionId:'s'},signal) as any;expect(list.pages).toHaveLength(2);expect(JSON.stringify(list)).not.toContain('secret');
 await expect(controller.pageOperation('page.prepare',{sessionId:'s'},signal)).rejects.toThrow('没有');
 const b=await listed(controller,'s','b'),approval=await controller.pageOperation('page.prepare',b,signal);
 expect(await controller.pageOperation('page.read',{sessionId:'s',ticket:(approval as any).ticket},signal)).toMatchObject({text:'B article'});expect(mocks.views[0].webContents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
 mocks.views[1].webContents.emit('did-start-navigation',{},'https://b.test/new',false,true);await expect(controller.pageOperation('page.prepare',b,signal)).rejects.toThrow('重新获取');
 controller.command({type:'close',id:'b'});await expect(controller.pageOperation('page.prepare',b,signal)).rejects.toThrow('没有');
 controller.command({type:'context',sessionId:'other'});expect(await controller.pageOperation('page.list',{sessionId:'other'},signal)).toEqual({pages:[]});controller.dispose();
});
