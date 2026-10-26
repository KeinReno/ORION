import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, type LucideIcon } from "lucide-react";

export interface QuickAction { id: string; label: string; icon: LucideIcon; disabled?: boolean; run: () => void }
export function QuickActions({ children, actions, disabled }: { children: ReactNode; actions: QuickAction[]; disabled: boolean }) {
  const [menu, setMenu] = useState<{ x: number; y: number; held: boolean } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const tracking = useRef<{ x: number; y: number; id: number; active: boolean; moved: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressUntil = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const clearTimer = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; }, []);
  const close = useCallback(() => {
    clearTimer(); tracking.current = null; root.current?.classList.remove("quick-holding");
    setMenu(null); setSelected(null);
  }, [clearTimer]);
  useEffect(() => { if (disabled) close(); }, [disabled, close]);
  function open(x: number, y: number, held = false) {
    setMenu({ held, x: Math.max(126, Math.min(innerWidth - 126, x)), y: Math.max(156, Math.min(innerHeight - 156, y)) });
    setSelected(null);
  }
  useEffect(() => {
    const stopPan = (event: TouchEvent) => { if (tracking.current?.active) event.preventDefault(); };
    // A release outside the gesture root must still drop the pending hold and its selection lock.
    const releaseOutside = () => {
      const current = tracking.current;
      if (current && !current.active) { clearTimer(); tracking.current = null; }
      root.current?.classList.remove("quick-holding");
    };
    const stopSelection = (event: Event) => { if (tracking.current) event.preventDefault(); };
    const element = root.current;
    element?.addEventListener("touchmove", stopPan, { passive: false });
    document.addEventListener("selectstart", stopSelection);
    window.addEventListener("pointerup", releaseOutside);
    window.addEventListener("pointercancel", releaseOutside);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      element?.removeEventListener("touchmove", stopPan);
      document.removeEventListener("selectstart", stopSelection);
      window.removeEventListener("pointerup", releaseOutside);
      window.removeEventListener("pointercancel", releaseOutside);
      element?.classList.remove("quick-holding");
    };
  }, [clearTimer]);
  useEffect(() => {
    if (!menu) return;
    const previous = document.activeElement as HTMLElement | null;
    if (!menu.held) panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    const cancel = () => close();
    const back = (event: Event) => { event.preventDefault(); close(); };
    window.addEventListener("orion-back", back);
    window.addEventListener("popstate", cancel);
    window.addEventListener("blur", cancel);
    return () => { window.removeEventListener("orion-back", back); window.removeEventListener("popstate", cancel); window.removeEventListener("blur", cancel); if (previous?.isConnected) previous.focus(); };
  }, [menu, close]);
  function actionAt(x: number, y: number) {
    const element = document.elementFromPoint(x, y)?.closest<HTMLButtonElement>("button[data-quick]");
    return element && !element.disabled ? element.dataset.quick ?? null : null;
  }
  return <div ref={root} className="gesture-root"
    onPointerDown={(event) => {
      if (event.isPrimary) suppressUntil.current = 0;
      if (disabled || menu || !event.isPrimary || event.button !== 0) return;
      const target = event.target as HTMLElement;
      // Text surfaces keep native selection and their own context menu.
      if (target.closest("button,a,summary,label,input,textarea,select,[contenteditable='true'],[data-task-id],.navigation,.finance-details,.dictation,.markdown-preview,.markdown-body,.release-notes,.changed-fields")) return;
      clearTimer();
      const holder = event.currentTarget;
      holder.classList.add("quick-holding");
      tracking.current = { x: event.clientX, y: event.clientY, id: event.pointerId, active: false, moved: false };
      timer.current = setTimeout(() => {
        if (!tracking.current) return;
        tracking.current.active = true;
        try { holder.setPointerCapture(event.pointerId); } catch { /* Pointer already ended. */ }
        try { window.getSelection()?.removeAllRanges(); } catch { /* Selection is not exposed in this WebView. */ }
        open(event.clientX, event.clientY, true);
        navigator.vibrate?.(15);
      }, 420);
    }}
    onPointerMove={(event) => {
      const current = tracking.current;
      if (!current || current.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 10) current.moved = true;
      if (!current.active) {
        if (current.moved) { clearTimer(); tracking.current = null; event.currentTarget.classList.remove("quick-holding"); }
        return;
      }
      event.preventDefault(); setSelected(current.moved ? actionAt(event.clientX, event.clientY) : null);
    }}
    onPointerUp={(event) => {
      const current = tracking.current; clearTimer();
      event.currentTarget.classList.remove("quick-holding");
      if (!current || current.id !== event.pointerId) return;
      tracking.current = null;
      if (!current.active) return;
      suppressUntil.current = Date.now() + 500;
      const id = current.moved ? actionAt(event.clientX, event.clientY) : null;
      if (id) { close(); actions.find((action) => action.id === id)?.run(); }
      else if (current.moved) close();
      else { setMenu((current) => current ? { ...current, held: false } : null); setSelected(null); }
    }}
    onLostPointerCapture={(event) => {
      // A child loses its implicit touch capture when the host takes explicit capture.
      if (event.target !== event.currentTarget || !tracking.current?.active || tracking.current.id !== event.pointerId) return;
      tracking.current = null; suppressUntil.current = Date.now() + 500;
      event.currentTarget.classList.remove("quick-holding");
      setMenu((current) => current ? { ...current, held: false } : null); setSelected(null);
    }}
    onPointerCancel={(event) => {
      if (tracking.current?.id !== event.pointerId) return;
      clearTimer();
      if (tracking.current.active) { suppressUntil.current = Date.now() + 500; setMenu((current) => current ? { ...current, held: false } : null); setSelected(null); }
      tracking.current = null;
      event.currentTarget.classList.remove("quick-holding");
    }}
    onContextMenu={(event) => {
      // A held press becomes quick actions; never let the native selection callout race it.
      if (tracking.current || menu) event.preventDefault();
    }}
    onClickCapture={(event) => { if (event.detail > 0 && Date.now() < suppressUntil.current) { suppressUntil.current = 0; event.preventDefault(); event.stopPropagation(); } }}>
    {children}
    <button ref={trigger} className="quick-trigger" aria-label="Быстрые действия" aria-haspopup="dialog" disabled={disabled} onClick={() => {
      const rect = trigger.current!.getBoundingClientRect(); open(rect.left + rect.width / 2, rect.top);
    }}><Plus size={24} /></button>
    {menu && <div className="quick-scrim" onClick={close}>
      <div ref={panel} className="quick-menu" role="dialog" aria-modal="true" aria-label="Быстрые действия" style={{ left: menu.x, top: menu.y }}
        onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
          if (event.key === "Escape") { event.stopPropagation(); close(); }
          if (event.key === "Tab") {
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
            const first = buttons[0]; const last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}>
        <svg className="quick-orbit" viewBox="0 0 252 288" aria-hidden="true"><circle cx="126" cy="144" r="33" />
          <path d="M126 105v-9m0 87v9m-39-48h-9m87 0h9M101 119l-7-7m57 7 7-7m-57 57-7 7m57-7 7 7" /></svg>
        <p className="quick-heading">Быстрые действия</p>
        {actions.map(({ id, label, icon: Icon, disabled: unavailable, run }, index) => <button key={id} data-quick={id}
          className={"quick-action quick-position-" + index} disabled={unavailable} aria-pressed={selected === id} onClick={() => { close(); run(); }}>
          <Icon size={24} /><span>{label}</span></button>)}
        <button className="quick-cancel" aria-label="Отменить быстрые действия" onClick={close}>×</button>
        <p className="quick-hint" role="status">{actions.find((action) => action.id === selected)?.label ?? (menu.held ? "Наведите на действие и отпустите" : "Выберите действие")}</p>
      </div>
    </div>}
  </div>;
}
