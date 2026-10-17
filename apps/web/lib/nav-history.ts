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
