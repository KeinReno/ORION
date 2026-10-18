/**
 * Back/forward history of the panels (objects and views) a window has shown. A panel id already
 * names the object and view (`task:<id>`, `projectplan:<id>`, `notes`), so the history is a plain
 * list of ids — no titles, no content, nothing that outlives the window or crosses a workspace.
 */
export interface NavHistory {
  readonly entries: readonly string[];
  readonly index: number;
}

export const EMPTY_NAV_HISTORY: NavHistory = { entries: [], index: -1 };
export const NAV_HISTORY_LIMIT = 50;

/** The panel that became active. Re-activating the current entry (including after back/forward) changes nothing. */
export function recordVisit(history: NavHistory, panelId: string): NavHistory {
  if (history.entries[history.index] === panelId) return history;
  const kept = history.entries.slice(0, history.index + 1);
  // Revisiting the same panel directly after itself never happens; revisiting an older one moves it to the end.
  const next = [...kept.filter(id => id !== panelId), panelId];
  const trimmed = next.length > NAV_HISTORY_LIMIT ? next.slice(next.length - NAV_HISTORY_LIMIT) : next;
  return { entries: trimmed, index: trimmed.length - 1 };
}

/** Nearest entry in `direction` that can still be shown; entries that are gone are skipped, not deleted. */
export function stepHistory(history: NavHistory, direction: -1 | 1, canShow: (panelId: string) => boolean): { history: NavHistory; target: string } | null {
  for (let i = history.index + direction; i >= 0 && i < history.entries.length; i += direction) {
    const id = history.entries[i]!;
    if (canShow(id)) return { history: { entries: history.entries, index: i }, target: id };
  }
  return null;
}

export function canStep(history: NavHistory, direction: -1 | 1, canShow: (panelId: string) => boolean): boolean {
  return stepHistory(history, direction, canShow) !== null;
}

/** Drop everything; used when the window changes workspace so nothing from the old one stays reachable. */
export function clearHistory(): NavHistory {
  return EMPTY_NAV_HISTORY;
}

/**
 * The history survives a reload or a crash: the same plain ids, one list per workspace, in the browser's storage.
 * A convenience — if storage is unavailable or holds junk, the window simply starts with an empty history.
 */
export function navHistoryStorageKey(workspaceId: string): string {
  return `orion.nav.history.v1:${workspaceId}`;
}

/** Reads a stored history; `exists` drops panels that are no longer in the registry, the index follows the entry it pointed at. */
export function readNavHistory(storage: Pick<Storage, "getItem">, workspaceId: string, exists: (panelId: string) => boolean = () => true): NavHistory {
  try {
    const raw = JSON.parse(storage.getItem(navHistoryStorageKey(workspaceId)) ?? "null") as { entries?: unknown; index?: unknown } | null;
    if (!raw || !Array.isArray(raw.entries)) return EMPTY_NAV_HISTORY;
    const current = typeof raw.index === "number" ? raw.entries[raw.index] : undefined;
    const seen = new Set<string>();
    const entries: string[] = [];
    for (const id of raw.entries) {
      if (typeof id !== "string" || id === "" || seen.has(id) || !exists(id)) continue;
      seen.add(id);
      entries.push(id);
    }
    const capped = entries.slice(-NAV_HISTORY_LIMIT);
    if (capped.length === 0) return EMPTY_NAV_HISTORY;
    const at = typeof current === "string" ? capped.indexOf(current) : -1;
    return { entries: capped, index: at >= 0 ? at : capped.length - 1 };
  } catch {
    return EMPTY_NAV_HISTORY;
  }
}

export function saveNavHistory(storage: Pick<Storage, "setItem" | "removeItem">, workspaceId: string, history: NavHistory): void {
  try {
    if (history.entries.length === 0) storage.removeItem(navHistoryStorageKey(workspaceId));
    else storage.setItem(navHistoryStorageKey(workspaceId), JSON.stringify({ entries: history.entries.slice(-NAV_HISTORY_LIMIT), index: history.index }));
  } catch {
    /* a convenience only */
  }
}
