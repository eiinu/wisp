import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
export const paneMinimum = 300, separatorWidth = 8;
export function splitWidths(total: number, ratio: number) {
  const available = Math.max(0, total - separatorWidth);
  if (available < paneMinimum * 2) return { narrow: true, left: total, right: total };
  const left = Math.min(available - paneMinimum, Math.max(paneMinimum, available * ratio));
  return { narrow: false, left, right: available - left };
}
const storageKey = 'wisp.workspace-split-ratio';
function rememberedRatio() { try { const value = Number(localStorage.getItem(storageKey)); return value > 0 && value < 1 ? value : .38; } catch { return .38; } }
export function SplitWorkspace({ visible, children, right }: { visible: boolean; children: React.ReactNode; right(state: { dragging: boolean }): React.ReactNode }) {
  const container = useRef<HTMLDivElement>(null), separator = useRef<HTMLDivElement>(null), leftId = useId();
  const [total, setTotal] = useState(0), [ratio, setRatio] = useState(rememberedRatio), [dragging, setDragging] = useState(false);
  const pointer = useRef<{ id: number; start: number } | undefined>(undefined);
  const widths = splitWidths(total, ratio);
  useLayoutEffect(() => {
    const measure = () => setTotal(container.current?.getBoundingClientRect().width ?? 0);
    measure(); const observer = new ResizeObserver(measure); if (container.current) observer.observe(container.current); window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  useEffect(() => { try { localStorage.setItem(storageKey, String(ratio)); } catch { /* Layout memory is optional. */ } }, [ratio]);
  function finish(cancel = false) {
    const active = pointer.current; if (!active) return;
    pointer.current = undefined; if (cancel) setRatio(active.start); setDragging(false);
    if (separator.current?.hasPointerCapture(active.id)) separator.current.releasePointerCapture(active.id);
  }
  useEffect(() => { const blur = () => finish(true); window.addEventListener('blur', blur); return () => { window.removeEventListener('blur', blur); if (pointer.current && separator.current?.hasPointerCapture(pointer.current.id)) separator.current.releasePointerCapture(pointer.current.id); }; }, []);
  useEffect(() => { if (!visible || widths.narrow) finish(true); }, [visible, widths.narrow]);
  function resize(left: number) { if (total >= paneMinimum * 2 + separatorWidth) setRatio(splitWidths(total, left / (total - separatorWidth)).left / (total - separatorWidth)); }
  return <div ref={container} className={`split-workspace ${widths.narrow ? 'split-narrow' : ''} ${dragging ? 'split-dragging' : ''}`}>
    <div id={leftId} className="split-primary" hidden={visible && widths.narrow} style={visible && !widths.narrow ? { flex: `0 0 ${widths.left}px` } : undefined}>{children}</div>
    {visible && !widths.narrow && <div ref={separator} className="workspace-separator" role="separator" aria-label="调整对话与预览宽度" aria-orientation="vertical" aria-controls={leftId} aria-valuemin={paneMinimum} aria-valuemax={Math.floor(total - separatorWidth - paneMinimum)} aria-valuenow={Math.round(widths.left)} aria-valuetext={`对话 ${Math.round(widths.left)} 像素，预览 ${Math.round(widths.right)} 像素`} tabIndex={0}
      onPointerDown={event => { if (event.button !== 0 || pointer.current) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); pointer.current = { id: event.pointerId, start: ratio }; setDragging(true); }}
      onPointerMove={event => { if (pointer.current?.id === event.pointerId) resize(event.clientX - (container.current?.getBoundingClientRect().left ?? 0)); }}
      onPointerUp={event => { if (pointer.current?.id === event.pointerId) finish(); }} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish()}
      onKeyDown={event => { const step = event.shiftKey ? 50 : 10; if (event.key === 'ArrowLeft') resize(widths.left - step); else if (event.key === 'ArrowRight') resize(widths.left + step); else if (event.key === 'Home') resize(paneMinimum); else if (event.key === 'End') resize(total - separatorWidth - paneMinimum); else if (event.key === 'Escape') finish(true); else return; event.preventDefault(); }}/>} 
    <div className="split-secondary" hidden={!visible}>{right({ dragging })}</div>
  </div>;
}
