"use client";

import { cx } from "@orion/ui";
import { useCallback, useEffect, useRef, useState } from "react";

const KEY_STEP = 24;

function readWidth(storageKey: string, fallback: number): number {
  try {
    const saved = Number(localStorage.getItem(storageKey));
    return Number.isFinite(saved) && saved > 0 ? saved : fallback;
  } catch {
    return fallback;
  }
}

/**
 * A side pane whose left edge can be dragged (or moved with ←/→ on the focused handle).
 * The width is a per-viewer convenience kept in localStorage; it is clamped to the
 * space actually available, so a narrow dock panel never ends up with an unreachable pane.
 */
export function ResizablePane({
  storageKey,
  defaultWidth = 416,
  minWidth = 320,
  maxWidth = 840,
  className,
  children
}: {
  storageKey: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const [width, setWidth] = useState(defaultWidth);
  const ref = useRef<HTMLDivElement>(null);
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    setWidth(readWidth(storageKey, defaultWidth));
  }, [storageKey, defaultWidth]);

  const clamp = useCallback(
    (value: number): number => {
      // Leave at least 240px for whatever sits beside the pane.
      const available = (ref.current?.parentElement?.clientWidth ?? Infinity) - 240;
      return Math.round(Math.max(minWidth, Math.min(value, maxWidth, Math.max(minWidth, available))));
    },
    [minWidth, maxWidth]
  );

  const persist = useCallback(
    (value: number) => {
      try {
        localStorage.setItem(storageKey, String(value));
      } catch {
        /* a remembered width is a convenience only */
      }
    },
    [storageKey]
  );

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = widthRef.current;
    const move = (e: PointerEvent): void => setWidth(clamp(startWidth + (startX - e.clientX)));
    const up = (): void => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      persist(widthRef.current);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = clamp(widthRef.current + (event.key === "ArrowLeft" ? KEY_STEP : -KEY_STEP));
    setWidth(next);
    persist(next);
  }

  return (
    <div ref={ref} style={{ width }} className={cx("relative shrink-0", className)}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Ширина панели"
        aria-valuenow={width}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDoubleClick={() => {
          setWidth(defaultWidth);
          persist(defaultWidth);
        }}
        title="Потяните, чтобы изменить ширину; двойной щелчок — сбросить"
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none transition-colors hover:bg-accent/30 focus-visible:bg-accent/40 focus-visible:outline-none"
      />
      {children}
    </div>
  );
}
