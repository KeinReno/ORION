/**
 * What the address bar of the built-in browser accepts. Only http(s) pages are ever put into a frame: `javascript:`,
 * `data:`, `file:`, `about:` and the like are refused outright, so a pasted or linked string can never run script in
 * ORION's window or read local files. A bare word or phrase is not a URL — it becomes a web search in the engine the
 * person chose.
 */

export type SearchEngineId = "google" | "yandex" | "bing" | "duckduckgo";

export interface SearchEngine {
  id: SearchEngineId;
  label: string;
  /** The query is appended encoded. */
  url: string;
  /**
   * Whether the engine's results page lets itself be shown in a frame. Google allows it with `igu=1`, Bing does; Yandex
   * and DuckDuckGo answer `X-Frame-Options`/`frame-ancestors` for framed pages in most setups, so they usually stay blank.
   */
  embeds: "yes" | "maybe" | "no";
}

export const SEARCH_ENGINES: readonly SearchEngine[] = [
  { id: "google", label: "Google", url: "https://www.google.com/search?igu=1&q=", embeds: "yes" },
  { id: "yandex", label: "Яндекс", url: "https://yandex.ru/search/?text=", embeds: "maybe" },
  { id: "bing", label: "Bing", url: "https://www.bing.com/search?q=", embeds: "yes" },
  { id: "duckduckgo", label: "DuckDuckGo", url: "https://duckduckgo.com/?q=", embeds: "no" }
];

export const DEFAULT_SEARCH_ENGINE: SearchEngineId = "google";

export function searchEngine(id: string | null | undefined): SearchEngine {
  return SEARCH_ENGINES.find((engine) => engine.id === id) ?? SEARCH_ENGINES.find((engine) => engine.id === DEFAULT_SEARCH_ENGINE)!;
}

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const LOOKS_LIKE_HOST = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\]|[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)(?::\d{1,5})?(?:[/?#].*)?$/iu;

export type BrowserTarget = { kind: "url"; url: string } | { kind: "search"; url: string } | { kind: "refused"; reason: string };

export function resolveBrowserInput(input: string, engine: SearchEngineId = DEFAULT_SEARCH_ENGINE): BrowserTarget {
  const text = input.trim();
  if (!text) return { kind: "refused", reason: "Введите адрес или запрос" };

  const scheme = SCHEME.exec(text);
  // "localhost:3000" and "127.0.0.1:8080" start with something that looks like a scheme: treat host:port as a host.
  const hostWithPort = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}(?:[/?#].*)?$/i.test(text);
  if (scheme && !hostWithPort) {
    const name = scheme[1]!.toLowerCase();
    if (name !== "http" && name !== "https") return { kind: "refused", reason: `Адреса «${name}:» не открываются во встроенном браузере` };
    try {
      const url = new URL(text);
      if (!url.hostname) return { kind: "refused", reason: "В адресе нет сайта" };
      return { kind: "url", url: url.toString() };
    } catch {
      return { kind: "refused", reason: "Не удалось разобрать адрес" };
    }
  }
  if (!/\s/.test(text) && LOOKS_LIKE_HOST.test(text)) {
    const local = /^(localhost|127\.|\[::1\]|10\.|192\.168\.)/i.test(text);
    try {
      return { kind: "url", url: new URL(`${local ? "http" : "https"}://${text}`).toString() };
    } catch {
      return { kind: "refused", reason: "Не удалось разобрать адрес" };
    }
  }
  return { kind: "search", url: `${searchEngine(engine).url}${encodeURIComponent(text)}` };
}

/**
 * ORION's own address is never framed inside ORION: the frame is sandboxed WITH `allow-same-origin` (pages need their own
 * storage to work), and a same-origin page in such a frame can lift its own sandbox and reach the app around it.
 */
export function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/** The short label of a tab: the site, without `www.`. */
export function tabLabel(url: string | null): string {
  if (!url) return "Новая вкладка";
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

/** Is this link one the in-app browser should take (a plain http(s) page)? */
export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
