import type React from "react";
import { dragEndWindowTarget, isBlockedDragTarget, isDraggablePanelId, isMacPlatform, panelDragHint, panelDragMode } from "./panel-drag";
import { ORION_PANEL_DRAG_MIME } from "./panel-drop";
import { detachPanelToWindow } from "./panel-window";

/**
 * Props to spread on a view's header (or on a tab strip whose buttons are handles) so the view can be
 * dragged out of it:
 *  - plain drag   → a panel INSIDE the app, where it is dropped on the dock (the payload is the same one
 *                   the sidebar uses, which `onDidDrop` in `(app)/layout.tsx` already understands);
 *                   dropped OUTSIDE the app window it becomes an OS window there, like a browser tab;
 *  - Ctrl/Cmd+drag → an OS window at the drop point, wherever that is. No dock payload is set, so the
 *                   dock never mistakes it for a drop of its own.
 *
 * HTML5 DnD needs `draggable` to be true when the press starts. Text fields, buttons, tables and the
 * editor are excluded (`isBlockedDragTarget`), and a drag only begins once the pointer moves, so plain
 * clicks and text selection elsewhere are untouched. `draggable` is switched on at press and off again on
 * release / drag end.
 *
 * `panelId` may be a fixed id, or null to resolve it from the nearest `[data-panel-drag]` ancestor of the
 * press (a tab strip with several handles; the title comes from `data-panel-title`).
 */
export function panelDragHandleProps(
  panelId: string | null,
  title?: string
): {
  onMouseDown: React.MouseEventHandler<HTMLElement>;
  onMouseUp: React.MouseEventHandler<HTMLElement>;
  onDragStart: React.DragEventHandler<HTMLElement>;
  onDragEnd: React.DragEventHandler<HTMLElement>;
  onMouseOver: React.MouseEventHandler<HTMLElement>;
  /** Fixed handle: the hint. Tab strip (panelId null): none up front — `onMouseOver` sets it only over a draggable tab. */
  title: string | undefined;
} {
  const isMac = typeof navigator !== "undefined" && isMacPlatform(navigator.platform);
  function holderOf(target: EventTarget | null): Element | null {
    return (target as Element | null)?.closest?.("[data-panel-drag]") ?? null;
  }
  function resolve(target: EventTarget | null): string | null {
    return panelId ?? holderOf(target)?.getAttribute("data-panel-drag") ?? null;
  }
  function disarm(element: HTMLElement): void {
    element.draggable = false;
    delete element.dataset.panelDragId;
    delete element.dataset.panelDragMode;
    delete element.dataset.panelDragTitle;
  }
  return {
    onMouseDown(event) {
      const element = event.currentTarget;
      const id = resolve(event.target);
      if (!isDraggablePanelId(id)) return;
      const target = event.target as Element | null;
      // For a tab strip the handle is the tab button itself, not the strip.
      const handle = panelId ? element : (holderOf(target) ?? element);
      const blocked = isBlockedDragTarget(target, handle);
      const mode = panelDragMode({ ...event, isMac, blockedTarget: blocked });
      if (!mode) return;
      element.draggable = true;
      element.dataset.panelDragId = id;
      element.dataset.panelDragMode = mode;
      element.dataset.panelDragTitle = title ?? holderOf(target)?.getAttribute("data-panel-title") ?? id;
    },
    onMouseUp(event) {
      disarm(event.currentTarget);
    },
    onDragStart(event) {
      const { panelDragId: id, panelDragMode: mode } = event.currentTarget.dataset;
      // Not armed by us (e.g. a native link/image drag bubbling up): leave it alone.
      if (!id || !mode) return;
      if (mode === "dock") {
        event.dataTransfer.setData(ORION_PANEL_DRAG_MIME, id);
        event.dataTransfer.effectAllowed = "copy";
      } else {
        // Window drag: some data is required for the drag to start, but nothing in the page may accept it.
        event.dataTransfer.setData("text/plain", id);
        event.dataTransfer.effectAllowed = "none";
      }
    },
    onDragEnd(event) {
      const element = event.currentTarget;
      const { panelDragId: id, panelDragMode: mode, panelDragTitle: name } = element.dataset;
      disarm(element);
      if (!id || (mode !== "dock" && mode !== "window")) return;
      const at = dragEndWindowTarget({
        mode,
        dropEffect: event.dataTransfer.dropEffect,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight
      });
      if (at) void detachPanelToWindow(id, name ?? id, at);
    },
    onMouseOver(event) {
      // A strip of several tabs gets the hint only while the pointer is over a tab that CAN be dragged.
      if (panelId) return;
      const strip = event.currentTarget;
      const overHandle = holderOf(event.target);
      const hint = overHandle && isDraggablePanelId(overHandle.getAttribute("data-panel-drag")) ? panelDragHint(isMac) : "";
      if (strip.title !== hint) strip.title = hint;
    },
    title: panelId ? panelDragHint(isMac) : undefined
  };
}
