import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Check, Pin, Trash2 } from "lucide-react";

export function SwipeRow({ children, enabled, rightLabel, onRight, onLeft, onHold }: {
  children: ReactNode; enabled: boolean; rightLabel: string;
  onRight: () => void; onLeft: () => void; onHold?: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const pointer = useRef<{ id: number; x: number; y: number; sliding: boolean; vertical: boolean } | null>(null);
  const delta = useRef(0);
  const skipClick = useRef(false);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => { if (hold.current) clearTimeout(hold.current); hold.current = null; };
  useEffect(() => () => clear(), []);
  const reset = () => { clear(); delta.current = 0; pointer.current = null; setOffset(0); };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || !event.isPrimary || event.button !== 0 || (event.target as Element).closest(".task-grip")) return;
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, sliding: false, vertical: false };
    skipClick.current = false;
    clear();
    if (onHold) hold.current = setTimeout(() => {
      if (pointer.current && !pointer.current.vertical && !pointer.current.sliding) {
        skipClick.current = true; pointer.current = null; onHold();
        if ("vibrate" in navigator) navigator.vibrate(12);
      }
    }, 550);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const value = pointer.current;
    if (!value || value.id !== event.pointerId || value.vertical) return;
    const x = event.clientX - value.x, y = event.clientY - value.y;
    if (!value.sliding && Math.abs(y) > 12 && Math.abs(y) > Math.abs(x)) {
      value.vertical = true; clear(); return;
    }
    if (Math.abs(x) > 12 && Math.abs(x) > Math.abs(y) * 1.15) {
      value.sliding = true; clear();
      delta.current = Math.max(-112, Math.min(112, x));
      setOffset(delta.current);
    }
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointer.current || pointer.current.id !== event.pointerId) return;
    const valid = pointer.current.sliding && Math.abs(delta.current) >= 76;
    const direction = delta.current > 0;
    if (pointer.current.sliding) skipClick.current = true;
    reset();
    if (valid) {
      if ("vibrate" in navigator) navigator.vibrate(12);
      if (direction) onRight(); else onLeft();
    }
  };
  return <div className="orion-swipe-row" data-swipe-enabled={enabled} onPointerDown={down} onPointerMove={move}
    onPointerUp={up} onPointerCancel={reset} onLostPointerCapture={reset}
    onClickCapture={(event) => { if (skipClick.current) { skipClick.current = false; event.preventDefault(); event.stopPropagation(); } }}>
    {enabled && <div className="orion-swipe-row__under" aria-hidden="true">
      <span className="orion-swipe-row__right">{rightLabel === "Закрепить" ? <Pin size={17} /> : <Check size={17} />}{rightLabel}</span>
      <span className="orion-swipe-row__left"><Trash2 size={17} />Удалить</span>
    </div>}
    <div className="orion-swipe-row__surface" style={{ transform: enabled ? "translate3d(" + offset + "px, 0, 0)" : undefined,
      transition: pointer.current?.sliding ? "none" : "transform 170ms cubic-bezier(.2,.8,.2,1)" }}>
      {children}
    </div>
  </div>;
}
