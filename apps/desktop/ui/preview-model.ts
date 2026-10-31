export type FileSource = { sessionId: string; workspace: string; path: string };
export type LinkSource = ({ kind: 'file' } & FileSource) | { kind: 'web'; url: string };
export type PreviewTarget = { kind: 'web'; url: string } | ({ kind: 'file' } & FileSource);
export type PreviewTab = { id: string; title: string; revision?: number } & (PreviewTarget | { kind: 'workspace' });
export interface PreviewState { tabs: PreviewTab[]; activeId?: string }
export type PreviewAction = { type: 'open'; id?: string; target: PreviewTarget | { kind: 'workspace' } } | { type: 'select' | 'close'; id: string } | { type: 'scope'; sessionId?: string; workspace?: string };

export function safeWebUrl(value: string, base?: string): string | undefined {
  if (!value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return;
  try { const url = new URL(value, base); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return; return url.href; } catch { return; }
}
export function linkTarget(href: string, source?: LinkSource): PreviewTarget | undefined {
  if (!href || href.startsWith('#')) return;
  const url = safeWebUrl(href, source?.kind === 'web' ? source.url : undefined);
  if (url) return { kind: 'web', url };
  if (source?.kind !== 'file' || /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('/') || href.includes('?')) return;
  let path: string; try { path = decodeURIComponent(href.split('#')[0]); } catch { return; }
  if (!path || path.startsWith('/') || /[\\\u0000-\u001f:]/.test(path)) return;
  const parts = source.path.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (part === '..') { if (!parts.length) return; parts.pop(); }
    else if (part && part !== '.') { if (part.startsWith('.')) return; parts.push(part); }
  }
  return parts.length ? { kind: 'file', sessionId: source.sessionId, workspace: source.workspace, path: parts.join('/') } : undefined;
}
export function tabId(target: PreviewTarget | { kind: 'workspace' }) {
  return target.kind === 'web' ? `web:${target.url}` : target.kind === 'file' ? `file:${JSON.stringify([target.sessionId, target.workspace, target.path])}` : 'workspace';
}
export function previewReducer(state: PreviewState, action: PreviewAction): PreviewState {
  if (action.type === 'open') {
    const id = action.id ?? tabId(action.target);
    if (state.tabs.some(tab => tab.id === id)) return { tabs: state.tabs.map(tab => tab.id === id && tab.kind === 'web' ? {...tab, revision: (tab.revision ?? 0) + 1} : tab), activeId: id };
    const title = action.target.kind === 'web' ? action.target.url ? new URL(action.target.url).hostname : '新网页' : action.target.kind === 'file' ? action.target.path.split('/').at(-1)! : '工作目录';
    return { tabs: [...state.tabs.slice(-11), { ...action.target, id, title }], activeId: id };
  }
  if (action.type === 'select') return state.tabs.some(tab => tab.id === action.id) ? { ...state, activeId: action.id } : state;
  const tabs = action.type === 'scope' ? state.tabs.filter(tab => tab.kind !== 'file' || tab.sessionId === action.sessionId && tab.workspace === action.workspace) : state.tabs.filter(tab => tab.id !== action.id);
  const oldIndex = state.tabs.findIndex(tab => tab.id === state.activeId);
  return { tabs, activeId: tabs.some(tab => tab.id === state.activeId) ? state.activeId : tabs[Math.min(oldIndex, tabs.length - 1)]?.id };
}
