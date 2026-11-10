/**
 * Where a navigation bar is drawn on this computer. Separate from the bar's
 * sections and folders: closing a window forgets only that it was detached.
 */

export interface NavWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NavWindowEntry {
  detached: boolean;
  bounds?: NavWindowBounds;
  workspaceBounds?: NavWindowBounds;
}

export interface NavWindowState {
  bars: Record<string, NavWindowEntry>;
}

/** A dock request closes only the detached window it names. */
export function dockMessageTargetsSidebar(message: { type?: string; sidebarId?: string }, sidebarId: string): boolean {
  return message.type === "dock" && message.sidebarId === sidebarId;
}

export function navWindowStorageKey(userId: string, workspaceId: string): string {
  return `orion.navSidebarWindows.v1.${userId}.${workspaceId}`;
}

export function initialNavWindows(): NavWindowState {
  return { bars: {} };
}

function isBounds(value: unknown): value is NavWindowBounds {
  if (typeof value !== "object" || value === null) return false;
  const bounds = value as Record<string, unknown>;
  return [bounds.x, bounds.y, bounds.width, bounds.height].every((item) => typeof item === "number" && Number.isFinite(item));
}

export function parseNavWindowState(raw: unknown): NavWindowState {
  if (typeof raw !== "object" || raw === null || !("bars" in raw)) return initialNavWindows();
  const source = (raw as { bars?: unknown }).bars;
  if (typeof source !== "object" || source === null || Array.isArray(source)) return initialNavWindows();
  const bars: Record<string, NavWindowEntry> = {};
  for (const [id, entry] of Object.entries(source)) {
    if (id === "" || id === "primary" || typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    bars[id] = {
      detached: record.detached === true,
      ...(isBounds(record.bounds) ? { bounds: record.bounds } : {}),
      ...(isBounds(record.workspaceBounds) ? { workspaceBounds: record.workspaceBounds } : {}),
    };
  }
  return { bars };
}

/** The primary bar stays in the main window. */
export function detachNavWindow(state: NavWindowState, sidebarId: string, bounds?: NavWindowBounds): NavWindowState {
  if (sidebarId === "" || sidebarId === "primary") return state;
  return {
    bars: {
      ...state.bars,
      [sidebarId]: { ...state.bars[sidebarId], detached: true, ...(bounds ? { bounds } : state.bars[sidebarId]?.bounds ? { bounds: state.bars[sidebarId]?.bounds } : {}) },
    },
  };
}

/** Closing the window puts the bar back. Its sections are not in this record. */
export function dockNavWindow(state: NavWindowState, sidebarId: string): NavWindowState {
  const current = state.bars[sidebarId];
  if (!current?.detached) return state;
  return { bars: { ...state.bars, [sidebarId]: { ...current, detached: false } } };
}

export function navHeartbeatKey(userId: string, workspaceId: string): string {
  return `orion.navSidebar.heartbeat.v1.${userId}.${workspaceId}`;
}

export function parseHeartbeat(raw: unknown): Record<string, number> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const beats: Record<string, number> = {};
  for (const [id, at] of Object.entries(raw)) {
    if (id === "" || id === "primary" || typeof at !== "number" || !Number.isFinite(at)) continue;
    beats[id] = at;
  }
  return beats;
}

/** True while the detached window has written a recent timestamp. */
export function heartbeatIsFresh(beats: Record<string, number>, sidebarId: string, now: number, maxAgeMs: number): boolean {
  const at = beats[sidebarId];
  return typeof at === "number" && now - at >= 0 && now - at <= maxAgeMs;
}

export function rememberNavWindowBounds(state: NavWindowState, sidebarId: string, bounds: NavWindowBounds): NavWindowState {
  const current = state.bars[sidebarId];
  if (!current?.detached) return state;
  return { bars: { ...state.bars, [sidebarId]: { ...current, bounds } } };
}

export function rememberNavWorkspaceBounds(state: NavWindowState, sidebarId: string, bounds: NavWindowBounds): NavWindowState {
  const current = state.bars[sidebarId];
  if (!current?.detached) return state;
  return { bars: { ...state.bars, [sidebarId]: { ...current, workspaceBounds: bounds } } };
}
