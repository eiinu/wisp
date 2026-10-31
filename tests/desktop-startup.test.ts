import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let ready!: () => void;
  const app = { whenReady: vi.fn(), getPath: vi.fn(() => '/tmp/wisp-startup-test'), on: vi.fn(), quit: vi.fn() };
  const host = { connected: true, on: vi.fn(), kill: vi.fn(), send: vi.fn() };
  const window = { webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn(), send: vi.fn() }, loadURL: vi.fn(), isDestroyed: vi.fn(() => false) };
  return { handle: vi.fn(), writeText: vi.fn(), app, host, window, fork: vi.fn(() => host), BrowserWindow: vi.fn(function () { return window; }), showErrorBox: vi.fn(),
    deferReady() { app.whenReady.mockReturnValue(new Promise<void>(resolve => { ready = resolve; })); }, ready() { ready(); } };
});
vi.mock('electron', () => ({ app: mocks.app, BrowserWindow: mocks.BrowserWindow, ipcMain: { handle: mocks.handle }, clipboard: { writeText: mocks.writeText },
  session: { defaultSession: { setPermissionRequestHandler: vi.fn() } },
  dialog: { showErrorBox: mocks.showErrorBox }, shell: {}, safeStorage: {} }));
vi.mock('node:child_process', () => ({ fork: mocks.fork }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); mocks.deferReady();
  mocks.window.loadURL.mockResolvedValue(undefined);
});

it('finishes ESM entry loading before ready, then creates the window without waiting for Host readiness', async () => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const loaded = await Promise.race([
      import('../apps/desktop/src/main.js').then(() => true),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 1000); }),
    ]);
    expect(loaded, 'Entry import must finish so Electron can release app readiness').toBe(true);
    expect(mocks.BrowserWindow).not.toHaveBeenCalled();
    expect(mocks.fork).not.toHaveBeenCalled();
    mocks.ready();
    await vi.waitFor(() => expect(mocks.window.loadURL).toHaveBeenCalledOnce());
    expect(mocks.BrowserWindow).toHaveBeenCalledOnce();
    expect(mocks.fork).toHaveBeenCalledWith(expect.stringContaining('/host/dist/main.js'),
      ['/tmp/wisp-startup-test', '--secure-credentials'], expect.objectContaining({ env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }) }));
    expect(mocks.window.loadURL).toHaveBeenCalledWith(expect.stringContaining('/ui-dist/index.html'));
    // No host-ready message or credential response has been delivered in this test.
    const quitHandler = mocks.app.on.mock.calls.find(([event]) => event === 'before-quit')?.[1];
    quitHandler(); expect(mocks.host.kill).toHaveBeenCalledOnce();
  } finally { clearTimeout(timer); mocks.ready(); }
});

it('reports a failed page load and quits instead of silently leaving startup pending', async () => {
  mocks.window.loadURL.mockRejectedValue(new Error('load failure'));
  await import('../apps/desktop/src/main.js');
  mocks.ready();
  await vi.waitFor(() => expect(mocks.showErrorBox).toHaveBeenCalledWith('Wisp 启动失败', expect.any(String)));
  expect(mocks.app.quit).toHaveBeenCalledOnce();
});

it('notifies the renderer when Host becomes ready so an initial snapshot can recover', async () => {
  await import('../apps/desktop/src/main.js'); mocks.ready();
  await vi.waitFor(() => expect(mocks.window.loadURL).toHaveBeenCalledOnce());
  const messageHandler = mocks.host.on.mock.calls.find(([event]) => event === 'message')?.[1];
  await messageHandler({type: 'host-ready'});
  expect(mocks.window.webContents.send).toHaveBeenCalledWith('wisp:notice', {type: 'changed'});
});

it('allows text copying only from the trusted main frame with a bounded string', async () => {
  await import('../apps/desktop/src/main.js'); mocks.ready();
  await vi.waitFor(() => expect(mocks.window.loadURL).toHaveBeenCalledOnce());
  const handler = mocks.handle.mock.calls.find(([channel]) => channel === 'wisp:copy-text')![1];
  const frame = { url: mocks.window.loadURL.mock.calls[0][0] };
  Object.assign(mocks.window.webContents, { mainFrame: frame });
  const event = { sender: mocks.window.webContents, senderFrame: frame };
  handler(event, '回复 😀');
  expect(mocks.writeText).toHaveBeenCalledExactlyOnceWith('回复 😀');
  for (const input of [null, {}, 123, 'x'.repeat(2_000_001)]) expect(() => handler(event, input)).toThrow('Invalid clipboard text');
  expect(() => handler({ ...event, sender: {} }, 'text')).toThrow('Untrusted sender');
  expect(() => handler({ ...event, senderFrame: { ...frame } }, 'text')).toThrow('Untrusted sender');
  frame.url = 'https://example.com';
  expect(() => handler(event, 'text')).toThrow('Untrusted sender');
  expect(mocks.writeText).toHaveBeenCalledTimes(1);
});
