import { describe, expect, it } from "vitest";
import {
  NAV_SIDEBAR_LIMIT,
  PRIMARY_SIDEBAR_ID,
  createNavSidebar,
  initialNavSidebars,
  movePanelToSidebar,
  panelsForSidebar,
  parseNavSidebarState,
  removeNavSidebar,
  updateNavSidebar,
} from "./sidebar-instances";

const PANELS = ["tasks", "notes", "finance", "calendar"] as const;

describe("initialNavSidebars", () => {
  it("starts with one primary bar and no placements", () => {
    expect(initialNavSidebars()).toEqual({
      sidebars: [{ id: "primary", name: "Основной", edge: "left", density: "full" }],
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
    expect(panelsForSidebar(back, PRIMARY_SIDEBAR_ID, panelIds)).toEqual(["tasks", "notes", "finance"]);
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
    expect(panelsForSidebar(state, "side-2", ["finance", "tasks", "calendar", "notes"])).toEqual(["tasks", "calendar"]);
    expect(panelsForSidebar(state, PRIMARY_SIDEBAR_ID, ["finance", "tasks", "calendar", "notes"])).toEqual(["finance", "notes"]);
    expect(panelsForSidebar(state, "nope", PANELS)).toEqual([]);
  });
});

describe("updateNavSidebar", () => {
  it("patches name, edge, and density without changing the id", () => {
    const state = initialNavSidebars();
    const updated = updateNavSidebar(state, "primary", { name: "  Дом  ", edge: "top", density: "compact" });
    expect(updated.sidebars[0]).toEqual({ id: "primary", name: "Дом", edge: "top", density: "compact" });
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
      { id: "primary", name: "Главный", edge: "bottom", density: "icons" },
      { id: "side-2", name: "Сайдбар", edge: "left", density: "full" },
      { id: "side-3", name: "Третий", edge: "right", density: "compact" },
    ]);
    expect(parsed.placement).toEqual({ notes: "side-2", finance: "primary" });
  });
});
