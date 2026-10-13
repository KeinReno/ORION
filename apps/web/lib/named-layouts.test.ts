import { describe, expect, it } from "vitest";
import {
  LAYOUT_LIMIT,
  cleanLayoutName,
  deleteNamedLayout,
  getNamedLayout,
  listNamedLayouts,
  namedLayoutsKey,
  saveNamedLayout,
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
