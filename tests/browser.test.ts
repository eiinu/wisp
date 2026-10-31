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
  controller.dispose(); expect(mocks.remote.listenerCount('will-download')).toBe(0);
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
