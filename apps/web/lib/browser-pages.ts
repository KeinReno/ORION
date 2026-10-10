import { DEFAULT_SEARCH_ENGINE, resolveBrowserInput, searchEngine, SEARCH_ENGINES, type SearchEngineId } from "./browser-url";

/**
 * A browser tab torn out into a dock panel of its own (`browsertab:<id>`) needs somewhere to keep its address: the dock
 * only remembers the panel's id. This is that place — a small map in the browser's storage, reading only web addresses back.
 * A convenience: if storage is unavailable the page simply opens empty.
 */

const PAGES_KEY = "orion.browser.pages.v1";
const ENGINE_KEY = "orion.browser.engine";

export function readPages(storage: Pick<Storage, "getItem">): Record<string, string> {
  try {
    const raw = JSON.parse(storage.getItem(PAGES_KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [id, url] of Object.entries(raw)) {
      if (typeof url === "string" && resolveBrowserInput(url).kind === "url") out[id] = url;
    }
    return out;
  } catch {
    return {};
  }
}

export function savePage(storage: Pick<Storage, "getItem" | "setItem">, id: string, url: string | null): void {
  try {
    const pages = readPages(storage);
    if (url === null) delete pages[id];
    else pages[id] = url;
    // Keep the map small: the most recent 200 pages are plenty for panels that can still be open.
    const entries = Object.entries(pages).slice(-200);
    storage.setItem(PAGES_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* a convenience only */
  }
}

export function readEngine(storage: Pick<Storage, "getItem">): SearchEngineId {
  try {
    const value = storage.getItem(ENGINE_KEY);
    return SEARCH_ENGINES.some((engine) => engine.id === value) ? (value as SearchEngineId) : DEFAULT_SEARCH_ENGINE;
  } catch {
    return DEFAULT_SEARCH_ENGINE;
  }
}

export function saveEngine(storage: Pick<Storage, "setItem">, id: SearchEngineId): void {
  try {
    storage.setItem(ENGINE_KEY, searchEngine(id).id);
  } catch {
    /* a convenience only */
  }
}

/** The dock panel id of a torn-out page. */
export function browserPanelId(pageId: string): string {
  return `browsertab:${pageId}`;
}
