"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "./is-tauri";
import { openNavSidebarChannel } from "./nav-sidebar-channel";
import { placeBarBeside } from "./nav-drag-live";
import { readDisplays } from "./read-displays";
import { restoreOnDisplays } from "./display-geometry";
import {
  detachNavWindow,
  dockNavWindow,
  heartbeatIsFresh,
  initialNavWindows,
  navHeartbeatKey,
  navWindowStorageKey,
  parseHeartbeat,
  parseNavWindowState,
  type NavWindowBounds,
  type NavWindowState,
} from "./nav-sidebar-windows";

const GRACE_MS = 8000;
const STALE_MS = 6000;

function readWindows(key: string): NavWindowState {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? initialNavWindows() : parseNavWindowState(JSON.parse(raw));
  } catch {
    return initialNavWindows();
  }
}

/**
 * Which extra bars are drawn in their own window. The main window reclaims a
 * bar when its window stops answering, so closing it or losing the display
 * does not remove the navigation.
 */
export function useNavSidebarHost(
  userId: string | undefined,
  workspaceId: string | undefined,
  onOpen: (panelId: string) => void,
): {
  state: NavWindowState;
  detach: (sidebarId: string) => void;
  dock: (sidebarId: string) => void;
} {
  const scope = userId && workspaceId ? navWindowStorageKey(userId, workspaceId) : null;
  const [state, setState] = useState<NavWindowState>(initialNavWindows);
  const [readyScope, setReadyScope] = useState<string | null>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const seen = useRef<Record<string, number>>({});
  const grace = useRef<Record<string, number>>({});
  const beatKeyRef = useRef<string | null>(null);
  beatKeyRef.current = userId && workspaceId ? navHeartbeatKey(userId, workspaceId) : null;

  useEffect(() => {
    if (!scope) return;
    setState(readWindows(scope));
    setReadyScope(scope);
  }, [scope]);

  useEffect(() => {
    if (!scope || readyScope !== scope) return;
    const next = JSON.stringify(state);
    if (window.localStorage.getItem(scope) === next) return;
    window.localStorage.setItem(scope, next);
  }, [readyScope, scope, state]);

  useEffect(() => {
    if (!scope) return;
    function onStorage(event: StorageEvent): void {
      if (event.key !== scope || event.newValue === null) return;
      try {
        const parsed = parseNavWindowState(JSON.parse(event.newValue));
        setState((current) => (JSON.stringify(current) === event.newValue ? current : parsed));
      } catch {
        setState(initialNavWindows());
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [scope]);

  useEffect(() => {
    const channel = openNavSidebarChannel();
    if (!channel) return;
    const onMessage = (event: MessageEvent<{ type?: string; sidebarId?: string; panelId?: string }>) => {
      const data = event.data;
      if (!data || typeof data.type !== "string") return;
      if (data.type === "hello" && data.sidebarId) seen.current[data.sidebarId] = Date.now();
      if (data.type === "dock" && data.sidebarId) setState((current) => dockNavWindow(current, data.sidebarId as string));
      if (data.type === "open" && data.panelId) onOpenRef.current(data.panelId);
      if (data.type === "ping") channel.postMessage({ type: "ping" });
    };
    channel.addEventListener("message", onMessage);
    const reclaim = () => {
      channel.postMessage({ type: "ping" });
      window.setTimeout(() => {
        const now = Date.now();
        let beats: Record<string, number> = {};
        try {
          beats = parseHeartbeat(JSON.parse(window.localStorage.getItem(beatKeyRef.current ?? "") ?? "null"));
        } catch {
          beats = {};
        }
        setState((current) => {
          let next = current;
          for (const [id, entry] of Object.entries(current.bars)) {
            if (!entry.detached) continue;
            if ((grace.current[id] ?? 0) > now) continue;
            if (heartbeatIsFresh(beats, id, now, STALE_MS)) continue;
            if (now - (seen.current[id] ?? 0) <= STALE_MS) continue;
            next = dockNavWindow(next, id);
          }
          return next;
        });
      }, 700);
    };
    const timer = window.setInterval(reclaim, STALE_MS);
    window.addEventListener("focus", reclaim);
    return () => {
      channel.removeEventListener("message", onMessage);
      window.removeEventListener("focus", reclaim);
      window.clearInterval(timer);
      channel.close();
    };
  }, []);

  const detach = useCallback((sidebarId: string) => {
    if (!workspaceId) return;
    grace.current[sidebarId] = Date.now() + GRACE_MS;
    const url = `/panel/nav-sidebar?id=${encodeURIComponent(sidebarId)}&workspaceId=${encodeURIComponent(workspaceId)}`;
    const saved = state.bars[sidebarId]?.bounds;
    setState((current) => detachNavWindow(current, sidebarId));
    void openDetachedBar(url, sidebarId, saved).then((opened) => {
      if (!opened) setState((current) => dockNavWindow(current, sidebarId));
    });
  }, [state.bars, workspaceId]);

  const dock = useCallback((sidebarId: string) => {
    const channel = openNavSidebarChannel();
    channel?.postMessage({ type: "dock", sidebarId });
    channel?.close();
    setState((current) => dockNavWindow(current, sidebarId));
  }, []);

  return { state, detach, dock };
}

async function detachedPlacement(bounds?: NavWindowBounds): Promise<NavWindowBounds> {
  const displays = await readDisplays();
  if (bounds) {
    return restoreOnDisplays({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(220, Math.round(bounds.width)),
      height: Math.max(480, Math.round(bounds.height))
    }, displays);
  }
  return placeBarBeside(
    { x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight },
    displays
  );
}

async function openDetachedBar(url: string, sidebarId: string, bounds?: NavWindowBounds): Promise<boolean> {
  const placed = await detachedPlacement(bounds);
  if (isTauri()) {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const opened = new WebviewWindow(`nav-sidebar-${sidebarId}-${Date.now()}`, {
      url,
      title: "ORION — сайдбар",
      width: placed.width,
      height: placed.height,
      minWidth: 220,
      minHeight: 480,
      x: placed.x,
      y: placed.y,
    });
    return new Promise((resolve) => {
      void opened.once("tauri://created", () => resolve(true));
      void opened.once("tauri://error", () => resolve(false));
    });
  }
  const features = `width=${placed.width},height=${placed.height},left=${placed.x},top=${placed.y}`;
  return window.open(url, `orion-nav-${sidebarId}`, features) !== null;
}
