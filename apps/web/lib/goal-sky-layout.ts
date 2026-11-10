import type { Constellation } from "./goal-constellation";

/** Hand-placed stars: star id -> position in layout coordinates. A personal arrangement, kept in the browser. */
export type SkyPins = Record<string, { x: number; y: number }>;

export interface SkyView { k: number; x: number; y: number }
export const HOME_VIEW: SkyView = { k: 1, x: 0, y: 0 };
/** Zoom floor kept low enough for large constellations to fit as a whole. */
export const MIN_SKY_ZOOM = 0.005;

/** Keep a newly selected world point in view; preserve the current framing when it is already visible. */
export function keepSkyPointVisible(
  view: SkyView,
  point: { x: number; y: number },
  viewportWidth: number,
  viewportHeight: number,
  padding = 64
): SkyView {
  const screenX = view.x + point.x * view.k;
  const screenY = view.y + point.y * view.k;
  if (
    screenX >= padding && screenX <= viewportWidth - padding &&
    screenY >= padding && screenY <= viewportHeight - padding
  ) return view;
  return {
    k: view.k,
    x: viewportWidth / 2 - point.x * view.k,
    y: viewportHeight / 2 - point.y * view.k
  };
}

/** World coordinates are deliberately unbounded; only reject invalid pointer values. */
export function worldPoint(x: number, y: number): { x: number; y: number } {
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

/** The constellation with pinned stars moved to where the person put them; links follow because they only name star ids. */
export function applyPins(constellation: Constellation, pins: SkyPins): Constellation {
  if (!constellation.stars.some((s) => pins[s.id])) return constellation;
  return {
    ...constellation,
    stars: constellation.stars.map((star) => {
      const pin = pins[star.id];
      return pin ? { ...star, ...worldPoint(pin.x, pin.y) } : star;
    })
  };
}

/** Pinned star ids that belong to this constellation (so "reset" only offers itself when something is pinned here). */
export function pinsOf(constellation: Constellation, pins: SkyPins): string[] {
  return constellation.stars.filter((s) => pins[s.id]).map((s) => s.id);
}

const STORAGE_PREFIX = "orion.goals.sky.pins.v1:";
const VISIBLE_LINKS_PREFIX = "orion.goals.sky.links.v1:";
const VIEWS_PREFIX = "orion.goals.sky.views.v2:";

export function loadViews(workspaceId: string): Record<string, SkyView> {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(VIEWS_PREFIX + workspaceId) ?? "{}");
    if (!raw || typeof raw !== "object") return {};
    const result: Record<string, SkyView> = {};
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      const view = value as Partial<SkyView>;
      if (Number.isFinite(view.k) && Number.isFinite(view.x) && Number.isFinite(view.y)) {
        result[id] = { k: Math.min(4, Math.max(MIN_SKY_ZOOM, view.k!)), x: view.x!, y: view.y! };
      }
    }
    return result;
  } catch { return {}; }
}

export function saveViews(workspaceId: string, views: Record<string, SkyView>): void {
  try { window.localStorage.setItem(VIEWS_PREFIX + workspaceId, JSON.stringify(views)); } catch { /* view remains usable for this session */ }
}

/** Personal presentation choice: links remain in the workspace, but map pins stay on this device. */
export function loadVisibleLinks(workspaceId: string): string[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(VISIBLE_LINKS_PREFIX + workspaceId) ?? "[]");
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function saveVisibleLinks(workspaceId: string, ids: ReadonlyArray<string>): void {
  try {
    window.localStorage.setItem(VISIBLE_LINKS_PREFIX + workspaceId, JSON.stringify(ids));
  } catch {
    // The current view still works when local storage is unavailable.
  }
}

/** localStorage may be missing, blocked or full — the sky must still render, just without memory. */
export function loadPins(workspaceId: string): SkyPins {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + workspaceId);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return {};
    const result: SkyPins = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const v = value as { x?: unknown; y?: unknown };
      if (typeof v?.x === "number" && typeof v?.y === "number" && Number.isFinite(v.x) && Number.isFinite(v.y)) result[id] = { x: v.x, y: v.y };
    }
    return result;
  } catch {
    return {};
  }
}

export function savePins(workspaceId: string, pins: SkyPins): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + workspaceId, JSON.stringify(pins));
  } catch {
    // Private window / quota: the arrangement lives until reload, which is acceptable for a convenience.
  }
}
