"use client";

import { useEffect, useRef } from "react";
import type { ObjectOpenMode, ViewRef } from "@orion/shared-types";
import { objectViewPanel } from "../lib/object-view";
import { openObject, useObjectOpeningAvailable } from "../lib/panel-bus";
import { useActiveWorkspace } from "../lib/use-active-workspace";

const ITEMS: { mode: ObjectOpenMode; label: string }[] = [
  { mode: "tab", label: "Открыть в новой вкладке" },
  { mode: "beside", label: "Открыть рядом" },
  { mode: "window", label: "Открыть в отдельном окне" }
];

/**
 * The same three opening commands as ObjectOpenMenu, anchored at a point (right click, Menu key,
 * Shift+F10) for dense views where a per-item "⋯" button does not fit. Arrow keys move, Enter
 * runs, Escape closes and focus returns to the item that opened it.
 */
export function ObjectOpenPopup({ view, title, at, onClose }: { view: ViewRef; title: string; at: { x: number; y: number }; onClose: () => void }): React.ReactElement | null {
  const available = useObjectOpeningAvailable();
  const { workspace } = useActiveWorkspace();
  const menuRef = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(typeof document === "undefined" ? null : document.activeElement);
  const allowed = available && Boolean(objectViewPanel(view, workspace?.id ?? null));

  function close(): void {
    onClose();
    if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
  }
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!allowed) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    function onPointerDown(event: PointerEvent): void {
      if (!menuRef.current?.contains(event.target as Node)) closeRef.current();
    }
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [allowed]);

  if (!allowed) return null;
  const left = Math.max(8, Math.min(at.x, window.innerWidth - 232));
  const top = Math.max(8, Math.min(at.y, window.innerHeight - 140));
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Открытие: ${title || "Без названия"}`}
      style={{ left, top }}
      className="fixed z-[70] w-56 rounded-xl border border-border bg-card p-1 shadow-xl shadow-black/40"
      onKeyDown={(event) => {
        const entries = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
        const index = entries.indexOf(document.activeElement as HTMLElement);
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        else if (event.key === "ArrowDown") { event.preventDefault(); entries[(index + 1) % entries.length]?.focus(); }
        else if (event.key === "ArrowUp") { event.preventDefault(); entries[(index - 1 + entries.length) % entries.length]?.focus(); }
        else if (event.key === "Tab") { event.preventDefault(); close(); }
      }}
    >
      {ITEMS.map(({ mode, label }) => (
        <button
          key={mode}
          type="button"
          role="menuitem"
          className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground focus-visible:bg-white/5 focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onClick={() => { onClose(); openObject(view, mode, title); }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
