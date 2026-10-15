import { describe, expect, it } from "vitest";
import {
  formatListAsText,
  formatListQuantity,
  groupListItems,
  listProgress,
  parseListLine,
  parseListText,
  reorderedIds,
  sortListItems
} from "./list";

describe("parseListLine", () => {
  it("reads a trailing quantity with a unit", () => {
    expect(parseListLine("Молоко, 2 л")).toEqual({ label: "Молоко", quantity: 2, unit: "л", checked: false });
    expect(parseListLine("Молоко 2 л")).toEqual({ label: "Молоко", quantity: 2, unit: "л", checked: false });
    expect(parseListLine("Сахар 1 кг.")).toEqual({ label: "Сахар", quantity: 1, unit: "кг", checked: false });
  });
  it("reads a leading quantity", () => {
    expect(parseListLine("2 л молока")).toEqual({ label: "молока", quantity: 2, unit: "л", checked: false });
    expect(parseListLine("3 х яблоки")).toEqual({ label: "яблоки", quantity: 3, checked: false });
  });
  it("reads ×N and a comma-separated bare number", () => {
    expect(parseListLine("Яйца x10")).toEqual({ label: "Яйца", quantity: 10, checked: false });
    expect(parseListLine("Хлеб, 2")).toEqual({ label: "Хлеб", quantity: 2, checked: false });
  });
  it("keeps a plain trailing number as part of the text", () => {
    expect(parseListLine("iPhone 15")).toEqual({ label: "iPhone 15", checked: false });
    expect(parseListLine("Хлеб 2")).toEqual({ label: "Хлеб 2", checked: false });
  });
  it("strips list markers and reads checkbox state", () => {
    expect(parseListLine("- Соль")).toEqual({ label: "Соль", checked: false });
    expect(parseListLine("1. Соль")).toEqual({ label: "Соль", checked: false });
    expect(parseListLine("[x] Соль")).toEqual({ label: "Соль", checked: true });
    expect(parseListLine("- [ ] Соль")).toEqual({ label: "Соль", checked: false });
  });
  it("returns null for blank lines", () => {
    expect(parseListLine("   ")).toBeNull();
    expect(parseListLine("- ")).toBeNull();
  });
});

describe("parseListText", () => {
  it("assigns sections from # headings and skips blanks", () => {
    const entries = parseListText("Мыло\n\n# Овощи\nМорковь, 2 кг\n[x] Лук\n## Молочка\nКефир");
    expect(entries.map((e) => [e.label, e.section ?? null, e.checked])).toEqual([
      ["Мыло", null, false],
      ["Морковь", "Овощи", false],
      ["Лук", "Овощи", true],
      ["Кефир", "Молочка", false]
    ]);
  });
  it("caps the number of entries", () => {
    expect(parseListText(Array.from({ length: 300 }, (_, i) => `Пункт ${i}`).join("\n"))).toHaveLength(200);
  });
});

const item = (over: Partial<{ id: string; checked: boolean; sortOrder: number; createdAt: string; section: string | null; priceMinor: number | null; quantity: number; unit: string | null; label: string }> = {}) => ({
  id: "i",
  label: "x",
  checked: false,
  sortOrder: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  section: null,
  priceMinor: null,
  quantity: 1,
  unit: null,
  ...over
});

describe("list helpers", () => {
  it("formats quantity", () => {
    expect(formatListQuantity({ quantity: 1, unit: null })).toBe("");
    expect(formatListQuantity({ quantity: 3, unit: null })).toBe("×3");
    expect(formatListQuantity({ quantity: 2, unit: "л" })).toBe("2 л");
  });
  it("sums known prices and counts unknown ones separately", () => {
    const progress = listProgress([item({ priceMinor: 1000 }), item({ priceMinor: null }), item({ checked: true, priceMinor: 500 })]);
    expect(progress).toEqual({ total: 3, checked: 1, open: 2, priceMinor: 1500, unpriced: 1 });
  });
  it("sorts by manual order with unticked first", () => {
    const sorted = sortListItems([item({ id: "a", checked: true, sortOrder: 1 }), item({ id: "b", sortOrder: 3 }), item({ id: "c", sortOrder: 2 })]);
    expect(sorted.map((i) => i.id)).toEqual(["c", "b", "a"]);
    expect(sortListItems([item({ id: "a", checked: true, sortOrder: 1 }), item({ id: "b", sortOrder: 3 })], false).map((i) => i.id)).toEqual(["a", "b"]);
  });
  it("groups with ungrouped first and keeps order", () => {
    const groups = groupListItems([item({ id: "1", section: "Б" }), item({ id: "2" }), item({ id: "3", section: "А" }), item({ id: "4", section: "Б" })]);
    expect(groups.map((g) => [g.section, g.items.map((i) => i.id)])).toEqual([[null, ["2"]], ["Б", ["1", "4"]], ["А", ["3"]]]);
  });
  it("reorders ids", () => {
    expect(reorderedIds(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
    expect(reorderedIds(["a", "b", "c"], "a", 99)).toEqual(["b", "c", "a"]);
  });
  it("round-trips through text", () => {
    const list = { name: "Продукты", items: [item({ id: "1", label: "Молоко", quantity: 2, unit: "л", section: "Молочка" }), item({ id: "2", label: "Соль", checked: true })] };
    const text = formatListAsText(list);
    expect(text).toBe("Продукты\n[x] Соль\n\n# Молочка\n[ ] Молоко, 2 л");
    const parsed = parseListText(text.split("\n").slice(1).join("\n"));
    expect(parsed.map((e) => [e.label, e.quantity ?? 1, e.unit ?? null, e.section ?? null, e.checked])).toEqual([
      ["Соль", 1, null, null, true],
      ["Молоко", 2, "л", "Молочка", false]
    ]);
  });
});
