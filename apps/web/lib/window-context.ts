/**
 * U04 (24-CONNECTED-CORE-BACKLOG.md) — each browser tab / Tauri window is an
 * independent "window context" (23-UNIVERSAL-CONNECTED-CORE.md, "Независимые
 * окна и раскладки": userId, windowId, workspaceId). Before this module the
 * only per-window primitive available was `sessionStorage` itself; nothing
 * gave code a stable id to key OTHER things by (debugging, future per-window
 * telemetry, explicit key composition in `use-active-workspace.ts` /
 * `dock-layout-key.ts`) without re-deriving it ad hoc in each call site.
 *
 * `sessionStorage` is the right primitive here, not `localStorage`: it is
 * natively scoped per browsing context by the browser/webview itself — two
 * independently opened tabs never see each other's `sessionStorage`, and a
 * reload of the SAME tab keeps it (only closing the tab drops it). That is
 * exactly "a window's own context survives reload, a new window starts
 * fresh" from the U04 done-criterion, for free, without any cross-tab
 * coordination code.
 *
 * Known caveat (documented, not fixed here): a same-origin `window.open()`
 * (dockview's own browser popout) is specified to seed the new browsing
 * context's `sessionStorage` as a COPY of the opener's at creation time —
 * so a freshly popped-out panel briefly shares the opener's windowId/active
 * workspace, then diverges independently afterward once either side writes.
 * That matches the actual use case (the popout is showing one panel FROM the
 * current window, not a deliberately distinct space) and was not something
 * this session could verify live (no browser tooling in the agent sandbox).
 */

const WINDOW_ID_STORAGE_KEY = "orion:window-id";

let cachedWindowId: string | null = null;

/**
 * Pure decision at the core of `getWindowId()`, pulled out so it is
 * unit-testable without touching real `sessionStorage`/`crypto`: reuse
 * `existing` if it's a non-empty string, otherwise mint a new one via
 * `generateId`.
 */
export function resolveWindowId(existing: string | null | undefined, generateId: () => string): string {
  return existing && existing.length > 0 ? existing : generateId();
}

/**
 * The current tab/window's stable id for this session. Cached in a module
 * variable after the first call so repeated calls within the same page
 * lifetime never re-touch storage; a fresh page load (real navigation, new
 * tab) always starts with an empty cache and re-derives it from
 * `sessionStorage` (or mints a new one).
 */
export function getWindowId(): string {
  if (cachedWindowId) return cachedWindowId;
  try {
    const existing = sessionStorage.getItem(WINDOW_ID_STORAGE_KEY);
    const id = resolveWindowId(existing, () => crypto.randomUUID());
    if (!existing) sessionStorage.setItem(WINDOW_ID_STORAGE_KEY, id);
    cachedWindowId = id;
    return id;
  } catch {
    // Private mode / storage disabled — fall back to an id that lives only
    // for this page's in-memory lifetime; it just won't survive a reload.
    if (!cachedWindowId) cachedWindowId = crypto.randomUUID();
    return cachedWindowId;
  }
}

/** Test-only: clears the module-level cache so tests can simulate a fresh page load. */
export function resetWindowIdCacheForTests(): void {
  cachedWindowId = null;
}
