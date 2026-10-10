import { describe, expect, it } from "vitest";
import { browserPanelId, readEngine, readPages, saveEngine, savePage } from "./browser-pages";
import { resolveBrowserInput, searchEngine, SEARCH_ENGINES } from "./browser-url";

function memory(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    }
  } as Storage;
}

describe("pages of torn-out browser tabs", () => {
  it("remembers a page and forgets it", () => {
    const storage = memory();
    savePage(storage, "b1", "https://example.com/a");
    expect(readPages(storage)).toEqual({ b1: "https://example.com/a" });
    savePage(storage, "b1", null);
    expect(readPages(storage)).toEqual({});
  });

  it("reads only web addresses back — a damaged or hand-edited value never reaches a frame", () => {
    const storage = memory({ "orion.browser.pages.v1": JSON.stringify({ ok: "https://a.b/", bad: "javascript:alert(1)", num: 5 }) });
    expect(readPages(storage)).toEqual({ ok: "https://a.b/" });
    expect(readPages(memory({ "orion.browser.pages.v1": "not json" }))).toEqual({});
    expect(readPages(memory({ "orion.browser.pages.v1": "[1,2]" }))).toEqual({});
  });

  it("names the dock panel of a page", () => {
    expect(browserPanelId("b_x1")).toBe("browsertab:b_x1");
  });
});

describe("search engine", () => {
  it("defaults to Google and falls back to it for an unknown value", () => {
    expect(readEngine(memory())).toBe("google");
    expect(readEngine(memory({ "orion.browser.engine": "altavista" }))).toBe("google");
    const storage = memory();
    saveEngine(storage, "yandex");
    expect(readEngine(storage)).toBe("yandex");
  });

  it("searches in the chosen engine, query encoded", () => {
    const google = resolveBrowserInput("как сварить борщ", "google");
    expect(google.kind === "search" && google.url).toBe(`https://www.google.com/search?igu=1&q=${encodeURIComponent("как сварить борщ")}`);
    const yandex = resolveBrowserInput("борщ", "yandex");
    expect(yandex.kind === "search" && yandex.url).toBe(`https://yandex.ru/search/?text=${encodeURIComponent("борщ")}`);
  });

  it("every engine address is a plain https URL ending where the query goes", () => {
    for (const engine of SEARCH_ENGINES) {
      expect(engine.url.startsWith("https://")).toBe(true);
      expect(engine.url.endsWith("=")).toBe(true);
      expect(searchEngine(engine.id)).toBe(engine);
    }
  });
});
