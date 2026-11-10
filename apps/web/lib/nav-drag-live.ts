/**
 * A drag that leaves this window. HTML5 drop does not cross an OS window, so
 * the source publishes screen coordinates and every other ORION window decides
 * whether the pointer is inside it.
 */

import { placeBesideDisplays, type DisplayArea } from "./display-geometry";

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NavSurface {
  windowId: string;
  kind: "main" | "nav";
  sidebarId?: string;
  bounds: ScreenRect;
  at: number;
}

export interface NavDragLive {
  panelId: string;
  phase: "move" | "end" | "cancel";
  screenX: number;
  screenY: number;
  sourceWindowId: string;
  mode: "dock" | "window";
}

export type NavDropTarget = { kind: "move"; sidebarId: string } | { kind: "open" };

/** A compact nav window is one drop surface; a workspace window has separate nav and Workbench surfaces. */
export function resolveNavDropTarget(args: {
  windowKind: "main" | "nav";
  currentSidebarId?: string;
  hitSidebarId?: string | null;
  hasWorkbench?: boolean;
}): NavDropTarget {
  if (args.hitSidebarId) return { kind: "move", sidebarId: args.hitSidebarId };
  if (args.windowKind === "nav" && !args.hasWorkbench && args.currentSidebarId) {
    return { kind: "move", sidebarId: args.currentSidebarId };
  }
  return { kind: "open" };
}

export const NAV_DRAG_LIVE_KEY = "orion.navDrag.live.v1";
export const NAV_SURFACE_PREFIX = "orion.navSurface.v1.";

export function navSurfaceKey(windowId: string): string {
  return `${NAV_SURFACE_PREFIX}${windowId}`;
}

export function pointInRect(x: number, y: number, rect: ScreenRect): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

/** Where a freshly detached bar should open: beside the host, on a connected display. */
export function placeBarBeside(host: ScreenRect, displays: readonly DisplayArea[]): ScreenRect {
  return placeBesideDisplays(host, displays);
}

export function parseNavDragLive(raw: unknown): NavDragLive | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.panelId !== "string" || value.panelId === "") return null;
  if (value.phase !== "move" && value.phase !== "end" && value.phase !== "cancel") return null;
  if (typeof value.screenX !== "number" || typeof value.screenY !== "number") return null;
  if (typeof value.sourceWindowId !== "string" || value.sourceWindowId === "") return null;
  return {
    panelId: value.panelId,
    phase: value.phase,
    screenX: value.screenX,
    screenY: value.screenY,
    sourceWindowId: value.sourceWindowId,
    mode: value.mode === "window" ? "window" : "dock",
  };
}

export function parseNavSurface(raw: unknown, now: number, maxAgeMs: number): NavSurface | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const bounds = value.bounds;
  if (typeof value.windowId !== "string" || (value.kind !== "main" && value.kind !== "nav")) return null;
  if (typeof value.at !== "number" || now - value.at > maxAgeMs || now - value.at < 0) return null;
  if (typeof bounds !== "object" || bounds === null) return null;
  const rect = bounds as Record<string, unknown>;
  if (![rect.x, rect.y, rect.width, rect.height].every((item) => typeof item === "number" && Number.isFinite(item))) return null;
  return {
    windowId: value.windowId,
    kind: value.kind,
    ...(typeof value.sidebarId === "string" ? { sidebarId: value.sidebarId } : {}),
    bounds: { x: rect.x as number, y: rect.y as number, width: rect.width as number, height: rect.height as number },
    at: value.at,
  };
}

/** The navigation window wins when it overlaps the main window. */
export function surfaceAt(surfaces: readonly NavSurface[], x: number, y: number, exceptWindowId?: string): NavSurface | null {
  const hits = surfaces.filter((surface) => surface.windowId !== exceptWindowId && pointInRect(x, y, surface.bounds));
  return hits.find((surface) => surface.kind === "nav") ?? hits[0] ?? null;
}

export function readSurfaces(entries: Record<string, string | null>, now: number, maxAgeMs = 10_000): NavSurface[] {
  const surfaces: NavSurface[] = [];
  for (const [key, raw] of Object.entries(entries)) {
    if (!key.startsWith(NAV_SURFACE_PREFIX) || raw === null) continue;
    try {
      const surface = parseNavSurface(JSON.parse(raw), now, maxAgeMs);
      if (surface) surfaces.push(surface);
    } catch {
      // A broken entry simply does not catch a drop.
    }
  }
  return surfaces;
}
