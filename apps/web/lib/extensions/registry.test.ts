import { PLUGIN_CATALOG, isModuleEnabled, isPluginEnabled, type OrionPluginId } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { createRegistry } from "./registry";

const Noop = () => null;
const all = (_id: OrionPluginId): boolean => true;
const none = (_id: OrionPluginId): boolean => false;

describe("extension registry", () => {
  it("is empty by default — a host with no plugins renders nothing in the slot", () => {
    expect(createRegistry().enabled("habits.insights", all)).toEqual([]);
  });

  it("returns only contributions whose plugin is enabled", () => {
    const registry = createRegistry();
    registry.contribute("habits.insights", { pluginId: "habits-insights", component: Noop });
    registry.contribute("habits.insights", { pluginId: "team", component: Noop });
    expect(registry.enabled("habits.insights", all).map((c) => c.pluginId)).toEqual(["habits-insights", "team"]);
    expect(registry.enabled("habits.insights", (id) => id === "team").map((c) => c.pluginId)).toEqual(["team"]);
    expect(registry.enabled("habits.insights", none)).toEqual([]);
  });

  it("orders by `order`, then by registration", () => {
    const registry = createRegistry();
    registry.contribute("habits.insights", { pluginId: "team", component: Noop, order: 5 });
    registry.contribute("habits.insights", { pluginId: "habits-insights", component: Noop, order: 1 });
    expect(registry.enabled("habits.insights", all).map((c) => c.pluginId)).toEqual(["habits-insights", "team"]);
  });

  it("keeps the first registration when a plugin registers the same slot twice", () => {
    const registry = createRegistry();
    const First = () => null;
    const Second = () => null;
    registry.contribute("habits.insights", { pluginId: "habits-insights", component: First });
    registry.contribute("habits.insights", { pluginId: "habits-insights", component: Second });
    expect(registry.all("habits.insights")).toHaveLength(1);
    expect(registry.all("habits.insights")[0]?.component).toBe(First);
  });

  it("keeps registries independent of each other", () => {
    const a = createRegistry();
    const b = createRegistry();
    a.contribute("habits.insights", { pluginId: "habits-insights", component: Noop });
    expect(b.all("habits.insights")).toEqual([]);
  });
});

describe("plugin catalog invariants (default-full parity)", () => {
  it("every plugin extends a module that exists and has a unique id", () => {
    const ids = PLUGIN_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const manifest of PLUGIN_CATALOG) expect(isModuleEnabled([], manifest.extendsModuleId)).toBe(true);
  });

  it("an extracted built-in is ON by default for every existing workspace, so nothing disappears on update", () => {
    const insights = PLUGIN_CATALOG.find((p) => p.id === "habits-insights");
    expect(insights?.defaultEnabled).toBe(true);
    // No override stored = at the default = on.
    expect(isPluginEnabled([], "habits-insights")).toBe(true);
    // Flipping it away from the default turns it off, and flipping again restores it.
    expect(isPluginEnabled(["habits-insights"], "habits-insights")).toBe(false);
  });

  it("the four finance plugins are extracted built-ins: on by default, each tied to the finance module", () => {
    for (const id of ["finance-budgeting", "finance-goals", "finance-recurring", "finance-reports"] as const) {
      const manifest = PLUGIN_CATALOG.find((p) => p.id === id);
      expect(manifest?.extendsModuleId).toBe("finance");
      expect(manifest?.defaultEnabled).toBe(true);
      expect(isPluginEnabled([], id)).toBe(true);
    }
  });

  it("the pre-existing optional plugin keeps its default (team stays off)", () => {
    expect(PLUGIN_CATALOG.find((p) => p.id === "team")?.defaultEnabled).toBe(false);
    expect(isPluginEnabled([], "team")).toBe(false);
  });
});
