import type { SidebarFolder } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { addFolder, deleteFolder, folderOf, groupOnto, moveFolder, moveToFolder, normalizeFolders, orderedIds, placeInFolder, reorderPanels, renameFolder, toggleFolder } from "./sidebar-folders";

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

describe("groupOnto", () => {
  it("dropping one ungrouped link onto another creates a new folder holding exactly the two", () => {
    const out = groupOnto([], "notes", "tasks", "n", "Работа");
    expect(out).toEqual([{ id: "n", name: "Работа", collapsed: false, items: ["tasks", "notes"] }]);
  });

  it("dropping onto a link that is already in a folder joins that same folder — same result as dropping on the folder itself", () => {
    const base = [f("a", ["tasks", "finance"], false, "Деньги")];
    const out = groupOnto(base, "notes", "tasks", "n", "fallback");
    expect(out).toEqual([{ id: "a", name: "Деньги", collapsed: false, items: ["notes", "tasks", "finance"] }]);
  });

  it("moves the dragged link out of its own folder first, so it can't end up in two places", () => {
    const base = [f("a", ["notes", "finance"])];
    const out = groupOnto(base, "notes", "tasks", "n", "Новая");
    expect(out).toEqual([{ id: "a", items: ["finance"], collapsed: false, name: "a" }, { id: "n", name: "Новая", collapsed: false, items: ["tasks", "notes"] }]);
  });

  it("refuses a self-drop and a full folder list", () => {
    expect(groupOnto([], "tasks", "tasks", "n", "Х")).toBeNull();
    expect(groupOnto(Array.from({ length: 12 }, (_, i) => f(`f${i}`)), "notes", "tasks", "n", "Х")).toBeNull();
  });

  it("falls back to «Новая папка» for a blank name", () => {
    expect(groupOnto([], "notes", "tasks", "n", "   ")?.[0]?.name).toBe("Новая папка");
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

describe("placeInFolder (drag and drop)", () => {
  const base = [
    { id: "a", name: "A", collapsed: false, items: ["tasks", "notes"] },
    { id: "b", name: "B", collapsed: false, items: ["time"] }
  ];
  it("inserts before the target inside the same folder (reorder)", () => {
    expect(placeInFolder(base, "notes", "a", "tasks")[0]!.items).toEqual(["notes", "tasks"]);
  });
  it("moves from another folder to a position, removing it from the first", () => {
    const next = placeInFolder(base, "time", "a", "notes");
    expect(next[0]!.items).toEqual(["tasks", "time", "notes"]);
    expect(next[1]!.items).toEqual([]);
  });
  it("appends when dropped on the folder itself or on an unknown neighbour", () => {
    expect(placeInFolder(base, "habits", "b")[1]!.items).toEqual(["time", "habits"]);
    expect(placeInFolder(base, "habits", "b", "missing")[1]!.items).toEqual(["time", "habits"]);
  });
  it("takes the panel out of every folder when dropped outside", () => {
    expect(placeInFolder(base, "tasks", null).map((f) => f.items)).toEqual([["notes"], ["time"]]);
  });
  it("dropping a panel on itself changes nothing", () => {
    expect(placeInFolder(base, "tasks", "a", "tasks")).toEqual(base);
  });
});

describe("own order of sections", () => {
  const ids = ["dash", "tasks", "notes", "time"];
  it("without a saved order the default order stands", () => {
    expect(orderedIds(ids, [])).toEqual(ids);
  });
  it("listed ids come first, new ones after in default order, unknown ones are dropped", () => {
    expect(orderedIds(ids, ["time", "gone", "tasks"])).toEqual(["time", "tasks", "dash", "notes"]);
  });
  it("moves a section before another, keeping the rest", () => {
    expect(reorderPanels(ids, [], "time", "tasks")).toEqual(["dash", "time", "tasks", "notes"]);
  });
  it("moves to the end when there is no neighbour", () => {
    expect(reorderPanels(ids, [], "dash")).toEqual(["tasks", "notes", "time", "dash"]);
  });
  it("keeps hidden modules recorded so they return to their place", () => {
    expect(reorderPanels(["a", "b"], ["hidden", "b", "a"], "a", "b")).toEqual(["a", "b", "hidden"]);
  });
  it("dropping on itself changes nothing", () => {
    expect(reorderPanels(ids, ["notes"], "tasks", "tasks")).toEqual(["notes"]);
  });
});
