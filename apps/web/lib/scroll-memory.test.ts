import { describe, expect, it } from "vitest";
import { readScrollMap, SCROLL_MAX_ENTRIES, saveScrollTop, scrollStorageKey } from "./scroll-memory";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

describe("scroll memory", () => {
  it("keeps positions per workspace and panel", () => {
    const store = memory();
    saveScrollTop(store, "w1", "tasks", 340.6);
    saveScrollTop(store, "w1", "notes", 12);
    saveScrollTop(store, "w2", "tasks", 7);
    expect(readScrollMap(store, "w1")).toEqual({ tasks: 341, notes: 12 });
    expect(readScrollMap(store, "w2")).toEqual({ tasks: 7 });
  });

  it("forgets a panel scrolled back to the top", () => {
    const store = memory();
    saveScrollTop(store, "w", "tasks", 100);
    saveScrollTop(store, "w", "tasks", 0);
    expect(readScrollMap(store, "w")).toEqual({});
  });

  it("caps the map, dropping the oldest, and ignores junk", () => {
    const store = memory();
    for (let i = 0; i < SCROLL_MAX_ENTRIES + 5; i++) saveScrollTop(store, "w", `p${i}`, 10);
    const map = readScrollMap(store, "w");
    expect(Object.keys(map)).toHaveLength(SCROLL_MAX_ENTRIES);
    expect(map.p0).toBeUndefined();
    const junk = memory({ [scrollStorageKey("w")]: JSON.stringify({ a: "x", b: -3, c: 5, d: null }) });
    expect(readScrollMap(junk, "w")).toEqual({ c: 5 });
    expect(readScrollMap(memory({ [scrollStorageKey("w")]: "[" }), "w")).toEqual({});
  });
});
