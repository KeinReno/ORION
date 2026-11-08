"use client";

import { useEffect, useRef } from "react";
import {
  NAV_DRAG_LIVE_KEY,
  navSurfaceKey,
  parseNavDragLive,
  pointInRect,
  type NavDragLive,
  type ScreenRect,
} from "./nav-drag-live";
import { openNavSidebarChannel } from "./nav-sidebar-channel";
import { getWindowId } from "./window-context";

function currentBounds(): ScreenRect {
  return { x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight };
}

function screenToClient(screenX: number, screenY: number): { x: number; y: number } {
  const borderX = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
  const chromeTop = Math.max(0, window.outerHeight - window.innerHeight - borderX);
  return { x: screenX - window.screenX - borderX, y: screenY - window.screenY - chromeTop };
}

let hot: Element | null = null;

function markHot(next: Element | null): void {
  const target = next?.closest("[data-orion-nav-before], [data-orion-nav-folder], [data-orion-nav]") ?? null;
  if (hot === target) return;
  hot?.removeAttribute("data-orion-nav-hot");
  target?.setAttribute("data-orion-nav-hot", "");
  hot = target;
}

export function publishNavDrag(live: NavDragLive): void {
  try {
    window.localStorage.setItem(NAV_DRAG_LIVE_KEY, JSON.stringify(live));
  } catch {
    // The other window simply will not see this move.
  }
  const channel = openNavSidebarChannel();
  channel?.postMessage({ type: "drag", ...live });
  channel?.close();
}

/**
 * Publishes this window's screen rectangle and accepts a section dragged out of
 * another ORION window. A drop on a bar moves the shortcut. A drop on the main
 * workbench focuses the section there.
 */
export function useNavDragBridge(options: {
  kind: "main" | "nav";
  sidebarId?: string;
  onMove: (panelId: string, sidebarId: string, folderId: string | null, beforeId?: string) => void;
  onOpenInside: (panelId: string) => void;
}): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const windowId = getWindowId();
    const publishSurface = () => {
      const current = optionsRef.current;
      const surface = {
        windowId,
        kind: current.kind,
        ...(current.sidebarId ? { sidebarId: current.sidebarId } : {}),
        bounds: currentBounds(),
        at: Date.now(),
      };
      try {
        window.localStorage.setItem(navSurfaceKey(windowId), JSON.stringify(surface));
      } catch {
        // A missing surface only disables a drop onto this window.
      }
    };
    publishSurface();
    const timer = window.setInterval(publishSurface, 400);
    window.addEventListener("resize", publishSurface);

    const apply = (live: NavDragLive) => {
      if (live.sourceWindowId === windowId || live.mode === "window") {
        if (live.phase !== "move") markHot(null);
        return;
      }
      if (!pointInRect(live.screenX, live.screenY, currentBounds())) {
        if (live.phase !== "move") markHot(null);
        return;
      }
      const local = screenToClient(live.screenX, live.screenY);
      const inside = local.x >= 0 && local.y >= 0 && local.x <= window.innerWidth && local.y <= window.innerHeight;
      if (live.phase === "move") {
        markHot(inside ? document.elementFromPoint(local.x, local.y) : null);
        return;
      }
      markHot(null);
      if (live.phase !== "end") return;
      const current = optionsRef.current;
      if (!inside) {
        if (current.kind === "nav" && current.sidebarId) current.onMove(live.panelId, current.sidebarId, null);
        return;
      }
      const hit = document.elementFromPoint(local.x, local.y);
      const nav = hit?.closest("[data-orion-nav]");
      const sidebarId = nav?.getAttribute("data-orion-nav") ?? (current.kind === "nav" ? current.sidebarId ?? null : null);
      if (sidebarId) {
        const before = hit?.closest("[data-orion-nav-before]")?.getAttribute("data-orion-nav-before") ?? undefined;
        const folder = hit?.closest("[data-orion-nav-folder]")?.getAttribute("data-orion-nav-folder") ?? null;
        current.onMove(live.panelId, sidebarId, folder, before === live.panelId ? undefined : before);
        return;
      }
      current.onOpenInside(live.panelId);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== NAV_DRAG_LIVE_KEY || !event.newValue) return;
      try {
        const live = parseNavDragLive(JSON.parse(event.newValue));
        if (live) apply(live);
      } catch {
        // A broken payload is not a drop.
      }
    };
    const channel = openNavSidebarChannel();
    const onMessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type !== "drag") return;
      const live = parseNavDragLive(event.data);
      if (live) apply(live);
    };
    channel?.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", publishSurface);
      window.removeEventListener("storage", onStorage);
      channel?.removeEventListener("message", onMessage);
      channel?.close();
      markHot(null);
      try {
        window.localStorage.removeItem(navSurfaceKey(windowId));
      } catch {
        // The next publish replaces it anyway.
      }
    };
  }, []);
}
