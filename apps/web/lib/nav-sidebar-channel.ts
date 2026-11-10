"use client";

/**
 * The detached bar and the main window share one channel. A click in the
 * detached bar asks the main window to focus the existing workbench tab.
 * It does not open a second workbench.
 */

export type NavSidebarMessage =
  | { type: "hello"; sidebarId: string }
  | { type: "ping" }
  | { type: "open"; panelId: string }
  | { type: "dock"; sidebarId: string }
  | { type: "dock-cancelled"; sidebarId: string }
  | { type: "host-bounds"; sidebarId: string; bounds: { x: number; y: number; width: number; height: number }; monitorId?: string };

const CHANNEL_NAME = "orion.navSidebar.window";

export function openNavSidebarChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}
