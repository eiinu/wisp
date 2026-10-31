import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { safeWebUrl, type PreviewTarget } from './preview-model.js';

type Pending = { target: PreviewTarget; owner: string };
const LinkContext = createContext<{ blocked: boolean; request(target: PreviewTarget, owner: string): void; cancel(owner: string): void } | undefined>(undefined);
export const useLinkConfirmation = () => useContext(LinkContext);
export function LinkConfirmationProvider({ children, onOpen }: { children: React.ReactNode; onOpen(target: PreviewTarget): void }) {
  const [pending, setPending] = useState<Pending>(), current = useRef<Pending | undefined>(undefined);
  const dialog = useRef<HTMLElement>(null);
  const request = useCallback((target: PreviewTarget, owner: string) => {
    if (target.kind === 'web' && !safeWebUrl(target.url)) return;
    current.current = { target: { ...target }, owner }; setPending(current.current);
  }, []);
  const cancel = useCallback((owner: string) => { if (current.current?.owner === owner) { current.current = undefined; setPending(undefined); } }, []);
  const close = useCallback(() => { current.current = undefined; setPending(undefined); }, []);
  useEffect(() => {
    if (!pending) return;
    const previous = document.activeElement as HTMLElement | null;
    const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    buttons[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
      if (event.key === 'Tab') {
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); if (previous?.isConnected) previous.focus(); };
  }, [!!pending, close]);
  return <LinkContext.Provider value={{ request, cancel, blocked: !!pending }}>{children}{pending && <div className="modal-backdrop link-confirmation" onClick={close}><section className="modal" role="alertdialog" aria-modal="true" aria-labelledby="link-confirm-title" aria-describedby="link-confirm-description" ref={dialog} onClick={e => e.stopPropagation()}>
    <div className="modal-heading"><h2 id="link-confirm-title">{pending.target.kind === 'web' ? '在右侧打开网页？' : '在右侧预览文件？'}</h2></div>
    <div className="modal-body"><p id="link-confirm-description">{pending.target.kind === 'web' ? '确认后会请求以下网站。网页内容由该网站提供，部分网站可能不允许嵌入。' : '确认后通过当前会话的授权目录读取文件。'}</p>
      <strong>{pending.target.kind === 'web' ? new URL(pending.target.url).hostname : '授权目录内文件'}</strong><p className="confirm-target">{pending.target.kind === 'web' ? pending.target.url : pending.target.path}</p>
      <div className="modal-actions"><button onClick={close}>取消</button><button className="primary" onClick={() => { const value = current.current; if (!value) return; close(); onOpen(value.target); }}>确认打开</button></div>
    </div></section></div>}</LinkContext.Provider>;
}
