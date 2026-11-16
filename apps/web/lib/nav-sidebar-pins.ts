/**
 * Pin (expanded/collapsed) state of each navigation bar, per person and per
 * workspace, on this computer only — the same scope as the bars' own layout
 * (`nav-sidebar-storage.ts`), so a bar collapsed on the work laptop never
 * surprises the home one. The default is **expanded**: a rail that hides its
 * labels until the user discovers the pin button reads as "broken" to a
 * first-time user.
 *
 * Pure data, like `sidebar-instances.ts`: storage access and React live in
 * `use-nav-sidebar-pins.ts`, so every rule here is unit-testable without a DOM.
 */

export type NavSidebarPins = Record<string, boolean>;

export interface NavSidebarPinsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function navSidebarPinsStorageKey(userId: string, workspaceId: string): string {
  return `orion.navSidebarPins.v1.${userId}.${workspaceId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only well-formed `sidebarId -> boolean` pairs survive; everything else is dropped. */
export function parseNavSidebarPins(raw: unknown): NavSidebarPins {
  if (!isRecord(raw)) return {};
  const pins: NavSidebarPins = {};
  for (const [sidebarId, value] of Object.entries(raw)) {
    if (sidebarId === "" || typeof value !== "boolean") continue;
    pins[sidebarId] = value;
  }
  return pins;
}

/** No saved state is a normal first run, not an error — callers then apply their default. */
export function loadNavSidebarPins(storage: NavSidebarPinsStorage, userId: string, workspaceId: string): NavSidebarPins {
  try {
    const raw = storage.getItem(navSidebarPinsStorageKey(userId, workspaceId));
    return raw === null ? {} : parseNavSidebarPins(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveNavSidebarPins(storage: NavSidebarPinsStorage, userId: string, workspaceId: string, pins: NavSidebarPins): void {
  try {
    storage.setItem(navSidebarPinsStorageKey(userId, workspaceId), JSON.stringify(pins));
  } catch {
    // A blocked or full store keeps the pin state for this visit.
  }
}

/**
 * The effective pin of one bar: the saved explicit choice wins, otherwise
 * `defaultValue`. The layout passes `bar.density !== "icons"` as the default,
 * so an icon-only bar still starts collapsed while every other bar starts expanded.
 */
export function navSidebarPinned(pins: NavSidebarPins, sidebarId: string, defaultValue = true): boolean {
  const saved = pins[sidebarId];
  return typeof saved === "boolean" ? saved : defaultValue;
}

/** Immutable set, so a React state swap is one new object reference. */
export function withNavSidebarPin(pins: NavSidebarPins, sidebarId: string, pinned: boolean): NavSidebarPins {
  if (pins[sidebarId] === pinned) return pins;
  return { ...pins, [sidebarId]: pinned };
}
