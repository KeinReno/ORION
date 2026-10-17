"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Rows [start, end) worth drawing for a scroll position, with `overscan` spare rows on both sides. */
export function visibleRange(scrollTop: number, viewport: number, rowHeight: number, count: number, overscan = 6): { start: number; end: number } {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const top = Math.max(0, scrollTop);
  const first = Math.floor(top / rowHeight);
  const last = Math.ceil((top + Math.max(0, viewport)) / rowHeight);
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + overscan) };
}

/** Below this many rows everything is drawn: short lists keep full Tab order and screen-reader counts. */
export const VIRTUALIZE_FROM = 80;

/**
 * Fixed-row-height list that draws only the rows in view once it gets long (presentational; the
 * context panel can hold a thousand files). The scroller is the element itself — give it a height.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  getKey,
  renderRow,
  label,
  className
}: {
  items: readonly T[];
  rowHeight: number;
  getKey: (item: T) => string;
  renderRow: (item: T, index: number) => ReactNode;
  label: string;
  className?: string;
}): React.ReactElement {
  const ref = useRef<HTMLUListElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(480);
  const windowed = items.length >= VIRTUALIZE_FROM;

  useEffect(() => {
    const node = ref.current;
    if (!node || !windowed) return;
    const measure = (): void => setViewport(node.clientHeight || 480);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [windowed]);

  const { start, end } = windowed ? visibleRange(scrollTop, viewport, rowHeight, items.length) : { start: 0, end: items.length };
  return (
    <ul
      ref={ref}
      aria-label={label}
      className={`orion-scroll min-h-0 overflow-y-auto ${className ?? ""}`}
      onScroll={windowed ? (event) => setScrollTop(event.currentTarget.scrollTop) : undefined}
    >
      {windowed ? <li aria-hidden style={{ height: start * rowHeight }} /> : null}
      {items.slice(start, end).map((item, offset) => (
        <li key={getKey(item)} aria-posinset={start + offset + 1} aria-setsize={items.length} style={windowed ? { height: rowHeight } : undefined}>
          {renderRow(item, start + offset)}
        </li>
      ))}
      {windowed ? <li aria-hidden style={{ height: (items.length - end) * rowHeight }} /> : null}
    </ul>
  );
}
