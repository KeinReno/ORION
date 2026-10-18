import { describe, expect, it } from "vitest";
import { canStep, EMPTY_NAV_HISTORY, NAV_HISTORY_LIMIT, navHistoryStorageKey, readNavHistory, recordVisit, saveNavHistory, stepHistory } from "./nav-history";

const visit = (...ids: string[]) => ids.reduce(recordVisit, EMPTY_NAV_HISTORY);
const any = () => true;

describe("nav history", () => {
  it("records visits in order and ignores a repeat of the current entry", () => {
    const h = recordVisit(visit("a", "b"), "b");
    expect(h.entries).toEqual(["a", "b"]);
    expect(h.index).toBe(1);
  });

  it("steps back and forward without re-recording", () => {
    const back = stepHistory(visit("a", "b", "c"), -1, any)!;
    expect(back.target).toBe("b");
    expect(recordVisit(back.history, "b")).toBe(back.history);
    const forward = stepHistory(back.history, 1, any)!;
    expect(forward.target).toBe("c");
  });

  it("drops the forward branch on a new visit", () => {
    const back = stepHistory(visit("a", "b", "c"), -1, any)!;
    const h = recordVisit(back.history, "d");
    expect(h.entries).toEqual(["a", "b", "d"]);
    expect(canStep(h, 1, any)).toBe(false);
  });

  it("moves a revisited panel to the end instead of duplicating it", () => {
    expect(visit("a", "b", "a").entries).toEqual(["b", "a"]);
  });

  it("skips panels that cannot be shown and reports nothing when none can", () => {
    const h = visit("a", "gone", "c");
    expect(stepHistory(h, -1, id => id !== "gone")!.target).toBe("a");
    expect(stepHistory(h, -1, () => false)).toBeNull();
    expect(stepHistory(EMPTY_NAV_HISTORY, -1, any)).toBeNull();
  });

  it("keeps a bounded history", () => {
    const ids = Array.from({ length: NAV_HISTORY_LIMIT + 10 }, (_, i) => `p${i}`);
    const h = visit(...ids);
    expect(h.entries).toHaveLength(NAV_HISTORY_LIMIT);
    expect(h.entries.at(-1)).toBe(ids.at(-1));
  });
});

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data
  };
}

describe("nav history persistence", () => {
  it("round-trips per workspace and keeps the position", () => {
    const store = memory();
    saveNavHistory(store, "w1", { entries: ["a", "b", "c"], index: 1 });
    saveNavHistory(store, "w2", visit("x"));
    expect(readNavHistory(store, "w1")).toEqual({ entries: ["a", "b", "c"], index: 1 });
    expect(readNavHistory(store, "w2").entries).toEqual(["x"]);
    expect(readNavHistory(store, "w3")).toEqual(EMPTY_NAV_HISTORY);
  });

  it("drops vanished panels and duplicates, and re-points the index", () => {
    const store = memory({ [navHistoryStorageKey("w")]: JSON.stringify({ entries: ["a", "gone", "b", "a", 5, ""], index: 2 }) });
    expect(readNavHistory(store, "w", id => id !== "gone")).toEqual({ entries: ["a", "b"], index: 1 });
  });

  it("caps an oversized or corrupt value", () => {
    const many = Array.from({ length: 80 }, (_, i) => `p${i}`);
    const store = memory({ [navHistoryStorageKey("w")]: JSON.stringify({ entries: many, index: 79 }) });
    const h = readNavHistory(store, "w");
    expect(h.entries).toHaveLength(NAV_HISTORY_LIMIT);
    expect(h.index).toBe(NAV_HISTORY_LIMIT - 1);
    expect(readNavHistory(memory({ [navHistoryStorageKey("w")]: "not json" }), "w")).toEqual(EMPTY_NAV_HISTORY);
  });

  it("removes the key for an empty history and survives a throwing storage", () => {
    const store = memory();
    saveNavHistory(store, "w", visit("a"));
    saveNavHistory(store, "w", EMPTY_NAV_HISTORY);
    expect(store.data.size).toBe(0);
    const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
    expect(readNavHistory(broken, "w")).toEqual(EMPTY_NAV_HISTORY);
    expect(() => saveNavHistory(broken, "w", visit("a"))).not.toThrow();
  });
});
