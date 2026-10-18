import { describe, expect, it } from "vitest";
import {
  componentHasDependentsErrorSchema,
  dependentsOf,
  enabledHardDependents,
  findHardDependencyCycle,
  isComponentEnabled,
  isComponentRequired
} from "./component-dependencies";
import { COMPONENT_MANIFESTS, type ComponentManifest } from "./component-manifest";
import { MODULE_CATALOG } from "./modules";
import { PLUGIN_CATALOG } from "./plugins";

const none = { disabledModules: [], pluginOverrides: [] };

describe("component dependents", () => {
  it("lists plugins of a module as hard dependents and modules as optional ones", () => {
    const dependents = dependentsOf("finance");
    const hard = dependents.filter((item) => item.relation === "requires");
    expect(hard.map((item) => item.id).sort()).toEqual(
      PLUGIN_CATALOG.filter((item) => item.extendsModuleId === "finance").map((item) => item.id).sort()
    );
    expect(hard.every((item) => item.kind === "plugin")).toBe(true);
    expect(dependents.some((item) => item.relation === "optional" && item.kind === "module")).toBe(true);
  });

  it("never reports a component as its own dependent and finds no dependents of a leaf plugin", () => {
    for (const manifest of COMPONENT_MANIFESTS) {
      expect(dependentsOf(manifest.id).some((item) => item.id === manifest.id)).toBe(false);
    }
    expect(dependentsOf(PLUGIN_CATALOG[0]!.id)).toEqual([]);
  });

  it("counts only enabled hard dependents", () => {
    const hostId = PLUGIN_CATALOG.find((item) => item.defaultEnabled)!.extendsModuleId;
    const all = enabledHardDependents(hostId, none);
    expect(all.length).toBeGreaterThan(0);
    const switchedOff = enabledHardDependents(hostId, {
      disabledModules: [],
      pluginOverrides: all.map((item) => item.id)
    });
    expect(switchedOff).toEqual([]);
  });

  it("treats a plugin of a disabled module as disabled", () => {
    const plugin = PLUGIN_CATALOG.find((item) => item.defaultEnabled)!;
    expect(isComponentEnabled("plugin", plugin.id, none)).toBe(true);
    expect(isComponentEnabled("plugin", plugin.id, { disabledModules: [plugin.extendsModuleId], pluginOverrides: [] })).toBe(false);
    expect(isComponentEnabled("module", "nope", none)).toBe(false);
  });

  it("reports required only for catalog modules flagged required", () => {
    for (const module of MODULE_CATALOG) expect(isComponentRequired("module", module.id)).toBe(module.required);
    expect(isComponentRequired("plugin", PLUGIN_CATALOG[0]!.id)).toBe(false);
    expect(isComponentRequired("module", "dashboard")).toBe(false);
  });

  it("finds no hard-dependency cycle in the catalog and detects a synthetic one", () => {
    expect(findHardDependencyCycle()).toBeNull();
    const make = (id: string, dep: string): ComponentManifest => ({
      ...COMPONENT_MANIFESTS[0]!,
      id,
      requires: { platform: "^1.0.0", modules: [dep], optionalModules: [] }
    });
    expect(findHardDependencyCycle([make("a", "b"), make("b", "a")])).toEqual(["a", "b", "a"]);
  });

  it("validates the 409 body", () => {
    expect(
      componentHasDependentsErrorSchema.safeParse({
        code: "component_has_dependents",
        message: "x",
        dependents: [{ id: "finance-goals", kind: "plugin", label: "Цели", relation: "requires" }]
      }).success
    ).toBe(true);
    expect(componentHasDependentsErrorSchema.safeParse({ code: "other" }).success).toBe(false);
  });
});
