import { afterEach, expect, it, vi } from 'vitest';
import { copyText } from '../apps/desktop/ui/clipboard.js';
afterEach(() => vi.unstubAllGlobals());
it('uses the desktop bridge without requesting browser clipboard permission', async () => {
  const browser = vi.fn(() => Promise.reject(new Error('denied')));
  vi.stubGlobal('navigator', { clipboard: { writeText: browser } });
  const desktop = { copyText: vi.fn().mockResolvedValue(undefined) };
  await copyText('回复', desktop);
  expect(desktop.copyText).toHaveBeenCalledExactlyOnceWith('回复');
  expect(browser).not.toHaveBeenCalled();
});
it('retains browser copying and gives an actionable error on denial or missing API', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  await copyText('web'); expect(writeText).toHaveBeenCalledExactlyOnceWith('web');
  writeText.mockRejectedValue(new Error('permission denied'));
  await expect(copyText('web')).rejects.toThrow('复制失败');
  vi.stubGlobal('navigator', {});
  await expect(copyText('web')).rejects.toThrow('手动选择');
});
it('does not retry through the browser when native copying fails', async () => {
  const browser = vi.fn(); vi.stubGlobal('navigator', { clipboard: { writeText: browser } });
  await expect(copyText('text', { copyText: vi.fn().mockRejectedValue(new Error('failed')) })).rejects.toThrow('复制失败');
  expect(browser).not.toHaveBeenCalled();
});
