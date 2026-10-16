import { describe, expect, it } from "vitest";
import { sanitizeDockLayout } from "./dock-layout-sanitize";

const leaf = (id: string, views: string[]) => ({ type: "leaf", size: 400, data: { id, views, activeView: views[0] } });
const base = () => ({
  grid: { width: 1200, height: 800, orientation: "HORIZONTAL", root: { type: "branch", size: 800, data: [leaf("g1", ["tasks", "gone"]), leaf("g2", ["removed-plugin"]), leaf("g3", ["note:1"])] } },
  panels: { tasks: { id: "tasks" }, gone: { id: "gone" }, "removed-plugin": { id: "removed-plugin" }, "note:1": { id: "note:1" } },
  activeGroup: "g2"
});
const keep = (id: string) => id !== "gone" && id !== "removed-plugin";
const view = { width: 1000, height: 700 };

describe("sanitizeDockLayout", () => {
  it("drops unknown panels and empty groups but keeps the rest", () => {
    const out = sanitizeDockLayout(base(), keep, view)!;
    expect(out.removedPanels.sort()).toEqual(["gone", "removed-plugin"]);
    expect(Object.keys(out.layout.panels as object).sort()).toEqual(["note:1", "tasks"]);
    const root = (out.layout.grid as { root: { data: { data: { id: string; views: string[] } }[] } }).root;
    expect(root.data.map((n) => n.data.id)).toEqual(["g1", "g3"]);
    expect(root.data[0]!.data.views).toEqual(["tasks"]);
    expect(out.layout.activeGroup).toBeUndefined();
  });
  it("does not mutate its input", () => {
    const input = base();
    sanitizeDockLayout(input, keep, view);
    expect(input).toEqual(base());
  });
  it("returns null when nothing usable is left or the shape is wrong", () => {
    expect(sanitizeDockLayout(base(), () => false, view)).toBeNull();
    expect(sanitizeDockLayout("x", keep, view)).toBeNull();
    expect(sanitizeDockLayout({ grid: {}, panels: {} }, keep, view)).toBeNull();
    const missing = base(); delete (missing.panels as Record<string, unknown>)["note:1"];
    expect(sanitizeDockLayout(missing, keep, view)).toBeNull();
  });
  it("pulls floating groups back inside the window and keeps pop-out tabs", () => {
    const input = { ...base(), floatingGroups: [{ data: { id: "f1", views: ["note:1"] }, position: { left: 3200, top: -50, width: 2000, height: 100 } }], popoutGroups: [{ data: { id: "p", views: ["tasks", "gone"] }, url: "/popout.html" }] } as Record<string, unknown>;
    (input.grid as { root: { data: unknown[] } }).root.data = [leaf("g1", ["note:1"])];
    (input.panels as Record<string, unknown>)["removed-plugin"] = undefined; delete (input.panels as Record<string, unknown>)["removed-plugin"]; delete (input.panels as Record<string, unknown>)["gone"];
    const out = sanitizeDockLayout(input, keep, view)!;
    expect(out.movedFloating).toBe(1);
    const pos = (out.layout.floatingGroups as { position: { left: number; top: number; width: number; height: number } }[])[0]!.position;
    expect(pos.width).toBe(1000); expect(pos.left).toBe(0); expect(pos.top).toBe(0); expect(pos.height).toBe(240);
    expect((out.layout.popoutGroups as { data: { views: string[] } }[])[0]!.data.views).toEqual(["tasks"]);
  });
  it("keeps a valid floating tab when the tiled grid only held an unknown one", () => {
    const input = {
      grid: { width: 1000, height: 700, orientation: "HORIZONTAL", root: { type: "branch", size: 700, data: [leaf("g1", ["gone"])] } },
      panels: { gone: { id: "gone" }, "note:1": { id: "note:1" } },
      floatingGroups: [{ data: { id: "f1", views: ["note:1", "removed-plugin"], activeView: "note:1" }, position: { left: 5000, top: 5000, width: 400, height: 300 } }]
    };
    (input.panels as Record<string, unknown>)["removed-plugin"] = { id: "removed-plugin" };
    const out = sanitizeDockLayout(input, keep, view)!;
    expect(out).not.toBeNull();
    const root = (out.layout.grid as { root: { data: { data: { id: string; views: string[] } }[] } }).root;
    expect(root.data.map((n) => n.data.views)).toEqual([["note:1"]]);
    expect(Object.keys(out.layout.panels as object)).toEqual(["note:1"]);
    expect(out.layout.floatingGroups).toEqual([]);
  });
  it("keeps tabs that live only outside the grid (empty grid, floating and pop-out)", () => {
    const input = {
      grid: { width: 1000, height: 700, orientation: "HORIZONTAL", root: { type: "branch", size: 700, data: [] } },
      panels: { tasks: { id: "tasks" }, "note:1": { id: "note:1" } },
      floatingGroups: [{ data: { id: "f1", views: ["note:1"] }, position: { left: 0, top: 0, width: 400, height: 300 } }],
      popoutGroups: [{ data: { id: "p1", views: ["tasks"] }, url: "/popout.html" }]
    };
    const out = sanitizeDockLayout(input, keep, view)!;
    const root = (out.layout.grid as { root: { data: { data: { views: string[] } }[] } }).root;
    expect(root.data.map((n) => n.data.views)).toEqual([["note:1"], ["tasks"]]);
    expect(Object.keys(out.layout.panels as object).sort()).toEqual(["note:1", "tasks"]);
  });
  it("is null when nothing usable remains anywhere", () => {
    const input = {
      grid: { width: 1000, height: 700, orientation: "HORIZONTAL", root: { type: "branch", size: 700, data: [leaf("g1", ["gone"])] } },
      panels: { gone: { id: "gone" }, "removed-plugin": { id: "removed-plugin" } },
      floatingGroups: [{ data: { id: "f1", views: ["removed-plugin"] }, position: { left: 0, top: 0, width: 400, height: 300 } }]
    };
    expect(sanitizeDockLayout(input, keep, view)).toBeNull();
  });
});
