import { describe, expect, it } from "vitest";
import {
  LAYOUT_LIMIT,
  cleanLayoutName,
  deleteNamedLayout,
  exportNamedLayouts,
  getDefaultLayoutName,
  getNamedLayout,
  importNamedLayouts,
  layoutShortcutIndex,
  listNamedLayouts,
  namedLayoutsKey,
  parseLayoutsImport,
  pruneDockLayout,
  renameNamedLayout,
  saveNamedLayout,
  setDefaultLayoutName,
  type StorageLike
} from "./named-layouts";

function memory(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    }
  };
}

const KEY = namedLayoutsKey("u1", "w1");

describe("named layouts", () => {
  it("keys by user and workspace", () => {
    expect(namedLayoutsKey("u1", "w1")).not.toBe(namedLayoutsKey("u1", "w2"));
    expect(namedLayoutsKey("u1", "w1")).not.toBe(namedLayoutsKey("u2", "w1"));
  });

  it("saves, lists sorted, reads back and overwrites by name", () => {
    const storage = memory();
    expect(saveNamedLayout(storage, KEY, "  Финансы ", { panels: [1] })).toBe(true);
    expect(saveNamedLayout(storage, KEY, "Дом", { panels: [2] })).toBe(true);
    expect(saveNamedLayout(storage, KEY, "Финансы", { panels: [3] })).toBe(true);
    expect(listNamedLayouts(storage, KEY)).toEqual(["Дом", "Финансы"]);
    expect(getNamedLayout(storage, KEY, "Финансы")).toEqual({ panels: [3] });
    expect(getNamedLayout(storage, KEY, "нет такой")).toBeNull();
  });

  it("refuses an empty name and a new name past the limit, but still allows overwriting", () => {
    const storage = memory();
    expect(saveNamedLayout(storage, KEY, "   ", {})).toBe(false);
    for (let i = 0; i < LAYOUT_LIMIT; i += 1) expect(saveNamedLayout(storage, KEY, `L${i}`, {})).toBe(true);
    expect(saveNamedLayout(storage, KEY, "лишняя", {})).toBe(false);
    expect(saveNamedLayout(storage, KEY, "L0", { again: true })).toBe(true);
  });

  it("deletes one layout and leaves the rest", () => {
    const storage = memory();
    saveNamedLayout(storage, KEY, "A", {});
    saveNamedLayout(storage, KEY, "B", {});
    deleteNamedLayout(storage, KEY, "A");
    expect(listNamedLayouts(storage, KEY)).toEqual(["B"]);
  });

  it("survives corrupt storage", () => {
    expect(listNamedLayouts(memory({ [KEY]: "{not json" }), KEY)).toEqual([]);
    expect(listNamedLayouts(memory({ [KEY]: "[1,2]" }), KEY)).toEqual([]);
    expect(getNamedLayout(memory({ [KEY]: JSON.stringify({ A: "{broken" }) }), KEY, "A")).toBeNull();
  });

  it("collapses whitespace and caps the name length", () => {
    expect(cleanLayoutName("  а   б  ")).toBe("а б");
    expect(cleanLayoutName("x".repeat(100))).toHaveLength(40);
  });
});

function dock(views: string[][]) {
  const panels: Record<string, unknown> = {};
  for (const id of views.flat()) panels[id] = { id, contentComponent: id, title: id };
  return {
    grid: {
      root: {
        type: "branch",
        data: views.map((v) => ({ type: "leaf", size: 100, data: { views: v, activeView: v[0], id: v.join() } })),
        size: 200
      },
      width: 1000,
      height: 600,
      orientation: "HORIZONTAL"
    },
    panels,
    activeGroup: "x"
  };
}

describe("default layout, rename, shortcuts", () => {
  it("marks, clears and forgets the default when the layout is deleted", () => {
    const s = memory();
    saveNamedLayout(s, KEY, "A", {});
    expect(setDefaultLayoutName(s, KEY, "нет")).toBe(false);
    expect(setDefaultLayoutName(s, KEY, "A")).toBe(true);
    expect(getDefaultLayoutName(s, KEY)).toBe("A");
    deleteNamedLayout(s, KEY, "A");
    expect(getDefaultLayoutName(s, KEY)).toBeNull();
    saveNamedLayout(s, KEY, "A", {});
    expect(getDefaultLayoutName(s, KEY)).toBeNull();
  });

  it("renames keeping content and default; refuses collisions and empty names", () => {
    const s = memory();
    saveNamedLayout(s, KEY, "A", { a: 1 });
    saveNamedLayout(s, KEY, "B", {});
    setDefaultLayoutName(s, KEY, "A");
    expect(renameNamedLayout(s, KEY, "A", "B")).toBe(false);
    expect(renameNamedLayout(s, KEY, "A", "  ")).toBe(false);
    expect(renameNamedLayout(s, KEY, "нет", "Z")).toBe(false);
    expect(renameNamedLayout(s, KEY, "A", " Новая ")).toBe(true);
    expect(getNamedLayout(s, KEY, "Новая")).toEqual({ a: 1 });
    expect(getNamedLayout(s, KEY, "A")).toBeNull();
    expect(getDefaultLayoutName(s, KEY)).toBe("Новая");
  });

  it("maps only a bare Alt+1..9 to an index", () => {
    const base = { altKey: true, ctrlKey: false, metaKey: false, shiftKey: false };
    expect(layoutShortcutIndex({ ...base, code: "Digit1" })).toBe(0);
    expect(layoutShortcutIndex({ ...base, code: "Digit9" })).toBe(8);
    expect(layoutShortcutIndex({ ...base, code: "Digit0" })).toBeNull();
    expect(layoutShortcutIndex({ ...base, ctrlKey: true, code: "Digit1" })).toBeNull();
    expect(layoutShortcutIndex({ ...base, altKey: false, code: "Digit1" })).toBeNull();
    expect(layoutShortcutIndex({ ...base, code: "KeyA" })).toBeNull();
  });
});

describe("pruneDockLayout", () => {
  it("drops unknown panels and empty groups without mutating the input", () => {
    const layout = dock([["tasks", "gone"], ["gone2"], ["notes"]]);
    const copy = JSON.stringify(layout);
    const pruned = pruneDockLayout(layout, (c) => c !== "gone" && c !== "gone2") as {
      panels: Record<string, unknown>;
      activeGroup?: string;
      grid: { root: { data: { data: { views: string[] } }[] } };
    };
    expect(JSON.stringify(layout)).toBe(copy);
    expect(Object.keys(pruned.panels)).toEqual(["tasks", "notes"]);
    expect(pruned.grid.root.data).toHaveLength(2);
    expect(pruned.grid.root.data[0].data.views).toEqual(["tasks"]);
    expect(pruned.activeGroup).toBeUndefined();
  });

  it("returns null when nothing survives or the shape is wrong", () => {
    expect(pruneDockLayout(dock([["a"]]), () => false)).toBeNull();
    expect(pruneDockLayout({ junk: 1 }, () => true)).toBeNull();
    expect(pruneDockLayout(null, () => true)).toBeNull();
  });
});

describe("export / import", () => {
  it("round-trips layouts and the default into another workspace", () => {
    const a = memory();
    saveNamedLayout(a, KEY, "Финансы", dock([["finance"]]));
    saveNamedLayout(a, KEY, "Дом", dock([["tasks"]]));
    setDefaultLayoutName(a, KEY, "Дом");
    const text = exportNamedLayouts(a, KEY);
    const b = memory();
    const key2 = namedLayoutsKey("u1", "w2");
    expect(importNamedLayouts(b, key2, text)).toMatchObject({ ok: true, added: 2, replaced: 0, skipped: 0 });
    expect(listNamedLayouts(b, key2)).toEqual(["Дом", "Финансы"]);
    expect(getDefaultLayoutName(b, key2)).toBe("Дом");
    expect(importNamedLayouts(b, key2, text)).toMatchObject({ ok: true, added: 0, replaced: 2 });
  });

  it("rejects corrupt input without touching storage", () => {
    const s = memory();
    for (const bad of [
      "",
      "{nope",
      "[]",
      "null",
      '{"format":"x"}',
      '{"format":"orion-layouts","version":9,"layouts":{}}',
      '{"format":"orion-layouts","version":1,"layouts":{"A":{"grid":1}}}',
      "x".repeat(2_100_000)
    ]) {
      expect(parseLayoutsImport(bad).ok).toBe(false);
      expect(importNamedLayouts(s, KEY, bad).ok).toBe(false);
    }
    expect(s.data).toEqual({});
  });

  it("skips invalid entries and respects the layout limit", () => {
    const good = dock([["tasks"]]);
    const layouts: Record<string, unknown> = { bad: { x: 1 } };
    for (let i = 0; i < LAYOUT_LIMIT + 2; i += 1) layouts[`L${i}`] = good;
    const text = JSON.stringify({ format: "orion-layouts", version: 1, default: "L0", layouts });
    const s = memory();
    const result = importNamedLayouts(s, KEY, text);
    expect(result).toMatchObject({ ok: true, added: LAYOUT_LIMIT, skipped: 3 });
    expect(getDefaultLayoutName(s, KEY)).toBe("L0");
  });
});
