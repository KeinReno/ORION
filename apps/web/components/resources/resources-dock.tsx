"use client";

import { Sheet, useMediaQuery } from "@orion/ui";
import { useQueryClient } from "@tanstack/react-query";
import { PanelRight } from "lucide-react";
import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { WORKSPACE_SCOPED_RESOURCE_KEYS } from "../../lib/resource-context";
import {
  RESOURCES_MAX_WIDTH,
  RESOURCES_MIN_WIDTH,
  resourceContextActions,
  setResourcesPanelOpen,
  setResourcesPanelWidth,
  useResourcesPanelPrefs
} from "../../lib/resource-context-store";
import { useActiveWorkspace } from "../../lib/use-active-workspace";
import { ResourcesPanel } from "./resources-panel";

const KEYBOARD_STEP = 16;

/**
 * Places the context panel in the shell (ADR-0014): a resizable column on the right on wide screens, a
 * sheet on narrow ones; closed until asked for, so it never takes width from someone who does not use it.
 * It also owns the workspace-switch rule: leaving a workspace drops its objects, its pin and its cached
 * files/links, so nothing of the old workspace can be shown under the new one.
 */
export function ResourcesDock(): React.ReactElement | null {
  const { workspace } = useActiveWorkspace();
  const queryClient = useQueryClient();
  const { open, width } = useResourcesPanelPrefs();
  const compact = useMediaQuery("(max-width: 767px)");
  const previousWorkspace = useRef<string | null>(null);
  const workspaceId = workspace?.id ?? null;

  useEffect(() => {
    const previous = previousWorkspace.current;
    if (previous && previous !== workspaceId) {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[1] === previous && WORKSPACE_SCOPED_RESOURCE_KEYS.includes(String(query.queryKey[0]))
      });
    }
    previousWorkspace.current = workspaceId;
    resourceContextActions.switchWorkspace(workspaceId);
  }, [workspaceId, queryClient]);

  // Alt+R toggles the panel. AltGr (Ctrl+Alt on Windows) is left to typing.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent): void {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
      if (event.code !== "KeyR") return;
      event.preventDefault();
      setResourcesPanelOpen(!open);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const close = useCallback(() => setResourcesPanelOpen(false), []);

  if (!open) return null;
  if (compact) {
    return (
      <Sheet open onClose={close} title="Контекст" width="min(26rem, 100vw)" bare>
        <ResourcesPanel onClose={close} />
      </Sheet>
    );
  }
  return (
    <aside aria-label="Контекстная панель: ресурсы, связи, свойства" style={{ width }} className="relative flex min-h-0 shrink-0 border-l border-border">
      <ResizeHandle width={width} />
      <div className="min-h-0 min-w-0 flex-1">
        <ResourcesPanel onClose={close} />
      </div>
    </aside>
  );
}

function ResizeHandle({ width }: { width: number }): React.ReactElement {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    drag.current = { startX: event.clientX, startWidth: width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    const start = drag.current;
    if (!start) return;
    // The panel is on the right edge: dragging left makes it wider.
    setResourcesPanelWidth(start.startWidth + (start.startX - event.clientX));
  }
  function onPointerUp(event: PointerEvent<HTMLDivElement>): void {
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step = event.shiftKey ? KEYBOARD_STEP * 4 : KEYBOARD_STEP;
    if (event.key === "ArrowLeft") setResourcesPanelWidth(width + step);
    else if (event.key === "ArrowRight") setResourcesPanelWidth(width - step);
    else if (event.key === "Home") setResourcesPanelWidth(RESOURCES_MIN_WIDTH);
    else if (event.key === "End") setResourcesPanelWidth(RESOURCES_MAX_WIDTH);
    else return;
    event.preventDefault();
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Ширина контекстной панели"
      aria-valuemin={RESOURCES_MIN_WIDTH}
      aria-valuemax={RESOURCES_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none hover:bg-accent/30 focus-visible:bg-accent/40 focus-visible:outline-none"
    />
  );
}

/** The button that shows/hides the panel (tab strip on desktop, header on a phone). */
export function ResourcesToggle({ size = "sm" }: { size?: "sm" | "md" }): React.ReactElement {
  const { open, toggle } = useResourcesPanelPrefs();
  const box = size === "sm" ? "h-6 w-6" : "h-11 w-11";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={open}
      aria-label="Контекстная панель: ресурсы, связи, свойства"
      title="Ресурсы, связи, свойства (Alt+R)"
      className={`flex ${box} items-center justify-center rounded hover:bg-white/10 hover:text-foreground ${open ? "text-accent-text" : "text-subtle-foreground"}`}
    >
      <PanelRight className={size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5"} aria-hidden />
    </button>
  );
}
