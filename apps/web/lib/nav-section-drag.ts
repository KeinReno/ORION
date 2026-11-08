import type React from "react";
import { dragEndWindowTarget } from "./panel-drag";
import { ORION_PANEL_DRAG_MIME } from "./panel-drop";
import { detachPanelToWindow, warmPanelDocument } from "./panel-window";
import { readSurfaces, surfaceAt, type NavDragLive } from "./nav-drag-live";
import { publishNavDrag } from "./use-nav-drag-bridge";
import { getWindowId } from "./window-context";

function storageEntries(): Record<string, string | null> {
  const entries: Record<string, string | null> = {};
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key) entries[key] = window.localStorage.getItem(key);
  }
  return entries;
}

/**
 * Drag a sidebar section onto the workbench, out of the window, or onto a bar
 * that lives in another OS window. Ctrl/Cmd forces a new window at the pointer.
 */
export function bindSectionDrag(
  panelId: string,
  title: string,
  canWindow: boolean,
): {
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: (event: React.DragEvent<HTMLElement>) => void;
} {
  return {
    onDragStart(event) {
      warmPanelDocument(panelId);
      event.dataTransfer.setData(ORION_PANEL_DRAG_MIME, panelId);
    },
    onDragEnd(event) {
      const mode = event.currentTarget.dataset.navDragMode === "window" ? "window" : "dock";
      const live: NavDragLive = {
        panelId,
        phase: "end",
        screenX: event.screenX,
        screenY: event.screenY,
        sourceWindowId: getWindowId(),
        mode,
      };
      publishNavDrag(live);
      if (event.dataTransfer.dropEffect !== "none") return;
      if (mode === "dock") {
        const hit = surfaceAt(readSurfaces(storageEntries(), Date.now()), event.screenX, event.screenY, getWindowId());
        if (hit) return;
      }
      if (!canWindow) return;
      const at = dragEndWindowTarget({
        mode,
        dropEffect: event.dataTransfer.dropEffect,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      });
      // On a second monitor WebView2 can keep clientX/clientY inside this
      // window while screenX/screenY are already on the other display.
      const screenOutside =
        event.screenX < window.screenX ||
        event.screenY < window.screenY ||
        event.screenX > window.screenX + window.outerWidth ||
        event.screenY > window.screenY + window.outerHeight;
      const target = at ?? (screenOutside && !(event.screenX === 0 && event.screenY === 0) ? { x: event.screenX, y: event.screenY } : null);
      if (!target) return;
      const point = target;
      window.setTimeout(() => {
        void detachPanelToWindow(panelId, title, point);
      }, 0);
    },
  };
}
