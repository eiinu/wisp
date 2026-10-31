export interface BrowserPage { id: string; url: string; title: string; loading: boolean; back: boolean; forward: boolean; error?: string }
export interface BrowserDownload { id: string; name: string; url: string; received: number; total: number; state: 'progressing' | 'completed' | 'cancelled' | 'interrupted' }
export interface BrowserSnapshot { pages: BrowserPage[]; downloads: BrowserDownload[] }
export type BrowserCommand = {type:'context';sessionId?:string;id?:string} | { type: 'snapshot' } | { type: 'open'; id: string; url: string } | { type: 'close' | 'back' | 'forward' | 'reload'; id: string } | { type: 'layout'; id?: string; bounds?: { x: number; y: number; width: number; height: number } } | { type: 'cancel-download'; id: string };
export interface BrowserBridge { command(command: BrowserCommand): Promise<BrowserSnapshot>; subscribe(callback: (state: BrowserSnapshot) => void): () => void }
export function browserUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) return;
  try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return; return url.href; } catch { return; }
}
