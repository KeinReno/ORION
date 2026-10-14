import type React from "react";
import { isBlockedDragTarget, isDraggablePanelId, isMacPlatform, panelDragHint, shouldStartPanelDrag } from "./panel-drag";
import { ORION_PANEL_DRAG_MIME } from "./panel-drop";

/**
 * Props to spread on a view's header (or on a tab strip whose buttons are handles) so
 * that Ctrl/Cmd+drag on it carries the panel id in the dock's drag payload — the same
 * one the sidebar uses, which `onDidDrop` in `(app)/layout.tsx` already understands.
 *
 * HTML5 DnD needs `draggable` to be true when the press starts, but a permanently
 * draggable header would hijack text selection and plain clicks. So `draggable` is
 * switched on only for a Ctrl/Cmd+primary press on a non-interactive spot, and off
 * again on release / drag end.
 *
 * `panelId` may be a fixed id, or null to resolve it from the nearest
 * `[data-panel-drag]` ancestor of the press (a tab strip with several handles).
 */
export function panelDragHandleProps(panelId: string | null): {
  onMouseDown: React.MouseEventHandler<HTMLElement>;
  onMouseUp: React.MouseEventHandler<HTMLElement>;
  onDragStart: React.DragEventHandler<HTMLElement>;
  onDragEnd: React.DragEventHandler<HTMLElement>;
  onMouseOver: React.MouseEventHandler<HTMLElement>;
  /** Fixed handle: the hint. Tab strip (panelId null): none up front — `onMouseOver` sets it only over a draggable tab. */
  title: string | undefined;
} {
  const isMac = typeof navigator !== "undefined" && isMacPlatform(navigator.platform);
  function resolve(target: EventTarget | null): string | null {
    if (panelId) return panelId;
    const holder = (target as Element | null)?.closest?.("[data-panel-drag]");
    return holder?.getAttribute("data-panel-drag") ?? null;
  }
  function disarm(element: HTMLElement): void {
    element.draggable = false;
    delete element.dataset.panelDragId;
  }
  return {
    onMouseDown(event) {
      const element = event.currentTarget;
      const id = resolve(event.target);
      if (!isDraggablePanelId(id)) return;
      const target = event.target as Element | null;
      // For a tab strip the handle is the tab button itself, not the strip.
      const handle = panelId ? element : (target?.closest?.("[data-panel-drag]") ?? element);
      const blocked = isBlockedDragTarget(target, handle);
      if (!shouldStartPanelDrag({ ...event, isMac, blockedTarget: blocked })) return;
      element.draggable = true;
      element.dataset.panelDragId = id;
    },
    onMouseUp(event) {
      disarm(event.currentTarget);
    },
    onDragStart(event) {
      const id = event.currentTarget.dataset.panelDragId;
      // Not armed by us (e.g. a native link/image drag bubbling up): leave it alone.
      if (!id) return;
      event.dataTransfer.setData(ORION_PANEL_DRAG_MIME, id);
      event.dataTransfer.effectAllowed = "copy";
    },
    onDragEnd(event) {
      disarm(event.currentTarget);
    },
    onMouseOver(event) {
      // A strip of several tabs gets the hint only while the pointer is over a tab that CAN be dragged.
      if (panelId) return;
      const strip = event.currentTarget;
      const overHandle = (event.target as Element | null)?.closest?.("[data-panel-drag]");
      const hint = overHandle && isDraggablePanelId(overHandle.getAttribute("data-panel-drag")) ? panelDragHint(isMac) : "";
      if (strip.title !== hint) strip.title = hint;
    },
    title: panelId ? panelDragHint(isMac) : undefined
  };
}
