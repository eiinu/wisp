export async function copyText(text: string, desktop?: { copyText(text: string): Promise<void> }): Promise<void> {
  try {
    if (desktop) await desktop.copyText(text);
    else await navigator.clipboard.writeText(text);
  } catch {
    throw new Error('复制失败，请重试或手动选择回复文本复制。');
  }
}
