import { describe, expect, it } from "vitest";
import {
  NAV_SIDEBAR_LIMIT,
  PRIMARY_SIDEBAR_ID,
  addNavFolder,
  createNavSidebar,
  defaultNavFolderId,
  deleteNavFolder,
  initialNavSidebars,
  movePanelToSidebar,
  panelsForSidebar,
  parseNavSidebarState,
  removeNavSidebar,
  seedDefaultNavFolders,
  updateNavSidebar,
} from "./sidebar-instances";

const PANELS = ["tasks", "notes", "finance", "calendar"] as const;

describe("initialNavSidebars", () => {
  it("starts with one primary bar and no placements", () => {
    expect(initialNavSidebars()).toEqual({
      sidebars: [{ id: "primary", name: "Основной", edge: "left", density: "full", order: [], folders: [] }],
      placement: {},
    });
  });
});

describe("createNavSidebar", () => {
  it("stops at three bars and keeps the same state", () => {
    const first = createNavSidebar(initialNavSidebars());
    const second = createNavSidebar(first);
    const third = createNavSidebar(second);
    expect(NAV_SIDEBAR_LIMIT).toBe(3);
    expect(second.sidebars.map((sidebar) => sidebar.id)).toEqual(["primary", "side-2", "side-3"]);
    expect(second.sidebars[1]).toMatchObject({ name: "Второй", edge: "right", density: "icons" });
    expect(second.sidebars[2]).toMatchObject({ name: "Третий", edge: "bottom", density: "icons" });
    expect(third).toBe(second);
    expect(third.sidebars).toHaveLength(3);
  });

  it("uses side-2 when that id is free, and the first free edge among left, right, bottom", () => {
    const parked = updateNavSidebar(initialNavSidebars(), PRIMARY_SIDEBAR_ID, { edge: "right" });
    const created = createNavSidebar(parked);
    expect(created.sidebars[1]).toMatchObject({ id: "side-2", name: "Второй", edge: "left", density: "icons" });
  });
});

describe("removeNavSidebar", () => {
  it("refuses to remove the primary bar", () => {
    const state = createNavSidebar(initialNavSidebars());
    expect(removeNavSidebar(state, PRIMARY_SIDEBAR_ID)).toBe(state);
    expect(removeNavSidebar(initialNavSidebars(), "primary").sidebars.map((sidebar) => sidebar.id)).toEqual(["primary"]);
  });

  it("sends panels from the removed bar back to primary and leaves the others", () => {
    let state = createNavSidebar(createNavSidebar(initialNavSidebars()));
    state = movePanelToSidebar(state, "notes", "side-2");
    state = movePanelToSidebar(state, "finance", "side-2");
    state = movePanelToSidebar(state, "calendar", "side-3");
    const removed = removeNavSidebar(state, "side-2");
    expect(removed.sidebars.map((sidebar) => sidebar.id)).toEqual(["primary", "side-3"]);
    expect(removed.placement).toEqual({ calendar: "side-3" });
    expect(panelsForSidebar(removed, PRIMARY_SIDEBAR_ID, PANELS)).toEqual(["tasks", "notes", "finance"]);
    expect(panelsForSidebar(removed, "side-3", PANELS)).toEqual(["calendar"]);
  });
});

describe("movePanelToSidebar", () => {
  it("keeps every supplied panel id and shows the moved one on the destination", () => {
    const state = createNavSidebar(initialNavSidebars());
    const panelIds = ["tasks", "notes", "finance"];
    const moved = movePanelToSidebar(state, "notes", "side-2");
    expect(panelIds).toEqual(["tasks", "notes", "finance"]);
    expect(panelsForSidebar(moved, "side-2", panelIds)).toEqual(["notes"]);
    expect(panelsForSidebar(moved, PRIMARY_SIDEBAR_ID, panelIds)).toEqual(["tasks", "finance"]);
    const back = movePanelToSidebar(moved, "notes", PRIMARY_SIDEBAR_ID);
    expect(back.placement).toEqual({});
    expect(panelsForSidebar(back, PRIMARY_SIDEBAR_ID, panelIds)).toEqual(["notes", "tasks", "finance"]);
  });

  it("appends a drop that has no neighbour after the shortcuts already on that bar", () => {
    let state = createNavSidebar(initialNavSidebars());
    state = movePanelToSidebar(state, "tasks", "side-2", { folderId: null, catalog: ["tasks"] });
    state = movePanelToSidebar(state, "notes", "side-2", { folderId: null, catalog: ["tasks", "notes"] });
    expect(panelsForSidebar(state, "side-2", ["finance", "tasks", "notes"])).toEqual(["tasks", "notes"]);
  });

  it("leaves state unchanged for an unknown bar", () => {
    const state = initialNavSidebars();
    expect(movePanelToSidebar(state, "tasks", "missing")).toBe(state);
  });

  it("preserves panelIds order and ignores placements that are not in the list", () => {
    let state = createNavSidebar(initialNavSidebars());
    state = movePanelToSidebar(state, "calendar", "side-2");
    state = movePanelToSidebar(state, "tasks", "side-2");
    state = { ...state, placement: { ...state.placement, ghost: "side-2", notes: "primary" } };
    expect(panelsForSidebar(state, "side-2", ["finance", "tasks", "calendar", "notes"])).toEqual(["calendar", "tasks"]);
    expect(panelsForSidebar(state, PRIMARY_SIDEBAR_ID, ["finance", "tasks", "calendar", "notes"])).toEqual(["finance", "notes"]);
    expect(panelsForSidebar(state, "nope", PANELS)).toEqual([]);
  });
});

describe("updateNavSidebar", () => {
  it("patches name, edge, and density without changing the id", () => {
    const state = initialNavSidebars();
    const updated = updateNavSidebar(state, "primary", { name: "  Дом  ", edge: "top", density: "compact" });
    expect(updated.sidebars[0]).toEqual({ id: "primary", name: "Дом", edge: "top", density: "compact", order: [], folders: [] });
    expect(updateNavSidebar(state, "missing", { name: "Нет" })).toBe(state);
  });
});

describe("storage round-trip", () => {
  it("restores bars, placement, and edges after JSON", () => {
    let state = createNavSidebar(createNavSidebar(initialNavSidebars()));
    state = movePanelToSidebar(state, "notes", "side-2");
    state = movePanelToSidebar(state, "finance", "side-3");
    state = updateNavSidebar(state, "side-2", { name: "Дом", edge: "right", density: "compact" });
    expect(parseNavSidebarState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });
});

describe("parseNavSidebarState", () => {
  it("rejects garbage", () => {
    const fresh = initialNavSidebars();
    for (const raw of [null, undefined, 1, "nope", [], true, { placement: {} }]) {
      expect(parseNavSidebarState(raw)).toEqual(fresh);
    }
  });

  it("keeps primary first, drops extras and unknown placements, and fills bad fields", () => {
    const parsed = parseNavSidebarState({
      sidebars: [
        { id: "side-2", name: "  ", edge: "nope", density: "huge" },
        { id: "primary", name: "  Главный  ", edge: "bottom", density: "icons" },
        { id: "primary", name: "Дубль", edge: "top", density: "compact" },
        { id: "side-3", name: "Третий", edge: "right", density: "compact" },
        { id: "side-4", name: "Лишний", edge: "left", density: "full" },
        null,
      ],
      placement: { tasks: "side-4", notes: "side-2", finance: "primary", calendar: "missing", "": "side-2", ghost: 1 },
    });
    expect(parsed.sidebars).toEqual([
      { id: "primary", name: "Главный", edge: "bottom", density: "icons", order: [], folders: [] },
      { id: "side-2", name: "Сайдбар", edge: "left", density: "full", order: [], folders: [] },
      { id: "side-3", name: "Третий", edge: "right", density: "compact", order: [], folders: [] },
    ]);
    expect(parsed.placement).toEqual({ notes: "side-2", finance: "primary" });
  });
});

describe("folders on every bar", () => {
  it("keeps a folder on the second bar and moves a shortcut into it without losing the shortcut", () => {
    let state = createNavSidebar(initialNavSidebars());
    state = addNavFolder(state, "side-2", "Дом", "home", "notes");
    expect(state.placement.notes).toBe("side-2");
    expect(state.sidebars[1]?.folders).toEqual([{ id: "home", name: "Дом", collapsed: false, items: ["notes"] }]);
    expect(panelsForSidebar(state, "side-2", PANELS)).toEqual(["notes"]);
    const dropped = movePanelToSidebar(state, "tasks", "missing", { folderId: "home" });
    expect(dropped).toBe(state);
    expect(panelsForSidebar(state, PRIMARY_SIDEBAR_ID, PANELS)).toContain("tasks");
  });

  it("moves a shortcut from one bar's folder into another bar's folder in one step", () => {
    let state = createNavSidebar(createNavSidebar(initialNavSidebars()));
    state = addNavFolder(state, "side-2", "Дом", "home", "notes");
    state = addNavFolder(state, "side-3", "Работа", "work");
    const moved = movePanelToSidebar(state, "notes", "side-3", { folderId: "work", beforeId: undefined });
    expect(moved.sidebars[1]?.folders[0]?.items).toEqual([]);
    expect(moved.sidebars[2]?.folders[0]?.items).toEqual(["notes"]);
    expect(moved.placement.notes).toBe("side-3");
    expect(panelsForSidebar(moved, "side-2", PANELS)).toEqual([]);
  });

  it("returns a deleted folder's shortcuts to that same bar", () => {
    let state = addNavFolder(initialNavSidebars(), PRIMARY_SIDEBAR_ID, "Дом", "home", "notes");
    state = deleteNavFolder(state, PRIMARY_SIDEBAR_ID, "home");
    expect(state.sidebars[0]?.folders).toEqual([]);
    expect(state.sidebars[0]?.order).toEqual(["notes"]);
    expect(panelsForSidebar(state, PRIMARY_SIDEBAR_ID, PANELS)).toContain("notes");
  });

  it("does not remove a shortcut when the destination folder is unknown", () => {
    const state = movePanelToSidebar(createNavSidebar(initialNavSidebars()), "notes", "side-2");
    expect(movePanelToSidebar(state, "notes", "side-2", { folderId: "missing" })).toBe(state);
    expect(state.placement.notes).toBe("side-2");
  });
});

describe("editable default folders", () => {
  const defaults = [
    { id: "dashboard" },
    { id: "tasks", group: "Работа" },
    { id: "notes", group: "Работа" },
    { id: "finance", group: "Деньги и склад" },
  ];

  it("materializes built-in groups without taking over custom folders or ungrouped links", () => {
    let state = addNavFolder(initialNavSidebars(), PRIMARY_SIDEBAR_ID, "Личное", "personal", "notes");
    state = seedDefaultNavFolders(state, PRIMARY_SIDEBAR_ID, defaults);
    expect(state.sidebars[0]?.folders).toEqual([
      { id: "personal", name: "Личное", collapsed: false, items: ["notes"] },
      { id: defaultNavFolderId("Работа"), name: "Работа", collapsed: false, items: ["tasks"] },
      { id: defaultNavFolderId("Деньги и склад"), name: "Деньги и склад", collapsed: false, items: ["finance"] },
    ]);
    expect(panelsForSidebar(state, PRIMARY_SIDEBAR_ID, ["dashboard", "tasks", "notes", "finance"])).toEqual([
      "dashboard", "notes", "tasks", "finance",
    ]);
  });

  it("keeps deleted defaults deleted and lets a section live outside every folder after reload", () => {
    let state = seedDefaultNavFolders(initialNavSidebars(), PRIMARY_SIDEBAR_ID, defaults);
    state = movePanelToSidebar(state, "notes", PRIMARY_SIDEBAR_ID, {
      folderId: null,
      catalog: defaults.map(({ id }) => id),
    });
    state = deleteNavFolder(state, PRIMARY_SIDEBAR_ID, defaultNavFolderId("Деньги и склад"));
    const restored = parseNavSidebarState(JSON.parse(JSON.stringify(state)));
    expect(restored.sidebars[0]?.defaultFoldersSeeded).toBe(true);
    expect(restored.sidebars[0]?.folders.map((folder) => folder.id)).toEqual([defaultNavFolderId("Работа")]);
    expect(restored.sidebars[0]?.folders[0]?.items).toEqual(["tasks"]);
    expect(restored.sidebars[0]?.order).toEqual(["dashboard", "notes", "finance"]);
    expect(seedDefaultNavFolders(restored, PRIMARY_SIDEBAR_ID, defaults)).toBe(restored);
    expect(panelsForSidebar(restored, PRIMARY_SIDEBAR_ID, defaults.map(({ id }) => id))).toEqual([
      "dashboard", "notes", "finance", "tasks",
    ]);
  });
});
