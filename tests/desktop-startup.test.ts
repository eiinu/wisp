import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let ready!: () => void;
  const app = { whenReady: vi.fn(), getPath: vi.fn(() => '/tmp/wisp-startup-test'), on: vi.fn(), quit: vi.fn() };
  const host = { connected: true, on: vi.fn(), kill: vi.fn(), send: vi.fn() };
  const window = { webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn(), send: vi.fn() }, loadURL: vi.fn(), isDestroyed: vi.fn(() => false) };
  return { app, host, window, fork: vi.fn(() => host), BrowserWindow: vi.fn(function () { return window; }), showErrorBox: vi.fn(),
    deferReady() { app.whenReady.mockReturnValue(new Promise<void>(resolve => { ready = resolve; })); }, ready() { ready(); } };
});
vi.mock('electron', () => ({ app: mocks.app, BrowserWindow: mocks.BrowserWindow, ipcMain: { handle: vi.fn() },
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
