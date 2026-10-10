import type { SidebarFolder } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { addFolder, deleteFolder, folderOf, moveFolder, moveToFolder, normalizeFolders, renameFolder, toggleFolder } from "./sidebar-folders";

const f = (id: string, items: string[] = [], collapsed = false, name = id): SidebarFolder => ({ id, name, collapsed, items });

describe("normalizeFolders", () => {
  it("returns nothing for anything that is not a list", () => {
    expect(normalizeFolders(null)).toEqual([]);
    expect(normalizeFolders({})).toEqual([]);
  });

  it("drops nameless or duplicate folders and keeps a panel in only its first folder", () => {
    const out = normalizeFolders([
      { id: "a", name: "  Работа  ", collapsed: true, items: ["tasks", "notes", "tasks"] },
      { id: "a", name: "дубль", items: [] },
      { id: "b", name: "   ", items: ["x"] },
      { id: "c", name: "Деньги", items: ["notes", "finance"] },
      "junk"
    ]);
    expect(out).toEqual([
      { id: "a", name: "Работа", collapsed: true, items: ["tasks", "notes"] },
      { id: "c", name: "Деньги", collapsed: false, items: ["finance"] }
    ]);
  });
});

describe("addFolder", () => {
  it("adds a folder, optionally moving a first panel out of its old one", () => {
    const base = [f("a", ["tasks", "notes"])];
    expect(addFolder(base, "Новая", "n")).toEqual([...base, { id: "n", name: "Новая", collapsed: false, items: [] }]);
    const moved = addFolder(base, "Личное", "n", "notes");
    expect(moved?.[0]?.items).toEqual(["tasks"]);
    expect(moved?.[1]).toEqual({ id: "n", name: "Личное", collapsed: false, items: ["notes"] });
  });

  it("refuses an empty name and a full list", () => {
    expect(addFolder([], "   ", "n")).toBeNull();
    expect(addFolder(Array.from({ length: 12 }, (_, i) => f(`f${i}`)), "ещё", "n")).toBeNull();
  });

  it("trims and shortens the name", () => {
    expect(addFolder([], "  a   b  ", "n")?.[0]?.name).toBe("a b");
    expect(addFolder([], "x".repeat(100), "n")?.[0]?.name).toHaveLength(40);
  });
});

describe("moveToFolder", () => {
  const base = [f("a", ["tasks"]), f("b", ["notes"])];

  it("moves a panel between folders and never leaves it in two", () => {
    const next = moveToFolder(base, "tasks", "b");
    expect(next.map((x) => x.items)).toEqual([[], ["notes", "tasks"]]);
  });

  it("takes a panel out of every folder with null", () => {
    expect(moveToFolder(base, "notes", null).map((x) => x.items)).toEqual([["tasks"], []]);
  });
});

describe("rename, delete, toggle, order", () => {
  it("renames, and refuses an empty name", () => {
    expect(renameFolder([f("a")], "a", " Дом ")?.[0]?.name).toBe("Дом");
    expect(renameFolder([f("a")], "a", " ")).toBeNull();
  });

  it("deleting a folder frees its panels instead of deleting them", () => {
    const next = deleteFolder([f("a", ["tasks"]), f("b", ["notes"])], "a");
    expect(next.map((x) => x.id)).toEqual(["b"]);
    expect(folderOf(next, "tasks")).toBeUndefined();
  });

  it("toggles the collapsed state of one folder", () => {
    expect(toggleFolder([f("a"), f("b")], "b").map((x) => x.collapsed)).toEqual([false, true]);
  });

  it("moves a folder up or down, and stays put at the ends", () => {
    const list = [f("a"), f("b"), f("c")];
    expect(moveFolder(list, "b", -1).map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(moveFolder(list, "b", 1).map((x) => x.id)).toEqual(["a", "c", "b"]);
    expect(moveFolder(list, "a", -1).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(moveFolder(list, "c", 1).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});
