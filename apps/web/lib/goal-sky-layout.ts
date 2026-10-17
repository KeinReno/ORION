import { CONSTELLATION_H, CONSTELLATION_W, type Constellation } from "./goal-constellation";

/** Hand-placed stars: star id -> position in layout coordinates. A personal arrangement, kept in the browser. */
export type SkyPins = Record<string, { x: number; y: number }>;

const MARGIN = 14;

export function clampToSky(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(CONSTELLATION_W - MARGIN, Math.max(MARGIN, x)),
    y: Math.min(CONSTELLATION_H - MARGIN, Math.max(MARGIN, y))
  };
}

/** The constellation with pinned stars moved to where the person put them; links follow because they only name star ids. */
export function applyPins(constellation: Constellation, pins: SkyPins): Constellation {
  if (!constellation.stars.some((s) => pins[s.id])) return constellation;
  return {
    ...constellation,
    stars: constellation.stars.map((star) => {
      const pin = pins[star.id];
      return pin ? { ...star, ...clampToSky(pin.x, pin.y) } : star;
    })
  };
}

/** Pinned star ids that belong to this constellation (so "reset" only offers itself when something is pinned here). */
export function pinsOf(constellation: Constellation, pins: SkyPins): string[] {
  return constellation.stars.filter((s) => pins[s.id]).map((s) => s.id);
}

const STORAGE_PREFIX = "orion.goals.sky.pins.v1:";
const VISIBLE_LINKS_PREFIX = "orion.goals.sky.links.v1:";

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
