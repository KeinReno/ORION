import { createElement, useEffect, useRef, type ReactNode } from "react";
import { useActiveWorkspace } from "./use-active-workspace";

/**
 * Where a dock panel was scrolled to, remembered per workspace so a reload puts the person back where they were.
 * The panel's main scroller is its first `.orion-scroll` element (what `PanelBody` renders); panels with their own
 * layout simply do not take part. A convenience: unavailable storage just means panels open at the top.
 */
const SCROLL_PREFIX = "orion.scroll.v1:";
export const SCROLL_MAX_ENTRIES = 100;

export function scrollStorageKey(workspaceId: string): string {
  return `${SCROLL_PREFIX}${workspaceId}`;
}

export function readScrollMap(storage: Pick<Storage, "getItem">, workspaceId: string): Record<string, number> {
  try {
    const raw = JSON.parse(storage.getItem(scrollStorageKey(workspaceId)) ?? "null") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, number> = {};
    for (const [id, top] of Object.entries(raw)) {
      if (typeof top === "number" && Number.isFinite(top) && top > 0) out[id] = Math.round(top);
    }
    return out;
  } catch {
    return {};
  }
}

/** Remembers `top` for the panel; a position back at the top forgets it. Oldest entries go first once the map is full. */
export function saveScrollTop(storage: Pick<Storage, "getItem" | "setItem">, workspaceId: string, panelId: string, top: number): void {
  try {
    const map = readScrollMap(storage, workspaceId);
    delete map[panelId];
    if (top > 0) map[panelId] = Math.round(top);
    const entries = Object.entries(map).slice(-SCROLL_MAX_ENTRIES);
    storage.setItem(scrollStorageKey(workspaceId), JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* a convenience only */
  }
}

/**
 * Wraps a dock panel (no box of its own). Scroll events do not bubble but can be captured, so one listener sees the
 * panel's scroller; restoring waits a moment for the panel's data to render tall enough, then gives up.
 */
export function PanelScrollMemory({ panelId, children }: { panelId: string; children?: ReactNode }): React.ReactElement {
  const workspaceId = useActiveWorkspace().workspace?.id;
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !workspaceId) return;
    const scroller = (): HTMLElement | null => host.querySelector<HTMLElement>(".orion-scroll");
    let restoring = true;
    let timer: number | undefined;
    const onScroll = (event: Event): void => {
      if (restoring || event.target !== scroller()) return;
      const top = (event.target as HTMLElement).scrollTop;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => saveScrollTop(window.localStorage, workspaceId, panelId, top), 300);
    };
    host.addEventListener("scroll", onScroll, true);
    const wanted = readScrollMap(window.localStorage, workspaceId)[panelId] ?? 0;
    let tries = 0;
    const restore = (): void => {
      const el = scroller();
      if (el && wanted > 0 && el.scrollHeight - el.clientHeight >= wanted) el.scrollTop = wanted;
      else if (wanted > 0 && tries++ < 20) {
        window.setTimeout(restore, 150);
        return;
      }
      restoring = false;
    };
    if (wanted > 0) restore();
    else restoring = false;
    return () => {
      restoring = true;
      host.removeEventListener("scroll", onScroll, true);
      window.clearTimeout(timer);
    };
  }, [workspaceId, panelId]);
  // `display: contents` keeps the wrapper out of the panel's layout.
  return createElement("div", { ref: hostRef, style: { display: "contents" } }, children);
}
