import { describe, expect, it } from "vitest";
import {
  COMPONENT_MANIFESTS,
  PLATFORM_API_VERSION,
  SURFACE_IDS,
  buildComponentManifests,
  componentManifestSchema,
  satisfiesVersionRange
} from "./component-manifest";
import { MODULE_CATALOG } from "./modules";
import { PLUGIN_CATALOG } from "./plugins";

const manifests = buildComponentManifests();
const moduleIds = new Set<string>(MODULE_CATALOG.map((m) => m.id));

describe("component manifests", () => {
  it("has a parsing manifest for every module and plugin", () => {
    expect(manifests).toHaveLength(MODULE_CATALOG.length + PLUGIN_CATALOG.length);
    for (const manifest of manifests) componentManifestSchema.parse(manifest);
    for (const m of MODULE_CATALOG) expect(manifests.find((x) => x.kind === "module" && x.id === m.id)).toBeDefined();
    for (const p of PLUGIN_CATALOG) expect(manifests.find((x) => x.kind === "plugin" && x.id === p.id)).toBeDefined();
    expect(COMPONENT_MANIFESTS).toEqual(manifests);
  });

  it("has unique ids across modules and plugins", () => {
    const ids = manifests.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("references only existing modules", () => {
    for (const m of manifests) {
      for (const id of [...m.requires.modules, ...m.requires.optionalModules]) {
        expect(moduleIds.has(id), `${m.id} -> ${id}`).toBe(true);
      }
    }
  });

  it("maps optionalDependencies and the plugin host faithfully", () => {
    for (const m of MODULE_CATALOG) {
      expect(manifests.find((x) => x.id === m.id)!.requires.optionalModules).toEqual(m.optionalDependencies);
    }
    for (const p of PLUGIN_CATALOG) {
      expect(manifests.find((x) => x.id === p.id)!.requires.modules).toEqual([p.extendsModuleId]);
    }
  });

  it("has no cycles among hard requires.modules", () => {
    const hard = new Map(manifests.map((m) => [m.id, m.requires.modules]));
    const state = new Map<string, "visiting" | "done">();
    const visit = (id: string, trail: string[]): void => {
      if (state.get(id) === "done") return;
      expect(state.get(id), `cycle: ${[...trail, id].join(" -> ")}`).not.toBe("visiting");
      state.set(id, "visiting");
      for (const next of hard.get(id) ?? []) visit(next, [...trail, id]);
      state.set(id, "done");
    };
    for (const id of hard.keys()) visit(id, []);
  });

  it("is satisfied by PLATFORM_API_VERSION", () => {
    for (const m of manifests) expect(satisfiesVersionRange(m.requires.platform, PLATFORM_API_VERSION), m.id).toBe(true);
  });
});

describe("satisfiesVersionRange", () => {
  it("handles caret, tilde, >= and exact ranges", () => {
    expect(satisfiesVersionRange("^1.0.0", "1.4.2")).toBe(true);
    expect(satisfiesVersionRange("^1.2.0", "1.1.9")).toBe(false);
    expect(satisfiesVersionRange("^1.0.0", "2.0.0")).toBe(false);
    expect(satisfiesVersionRange("^0.2.0", "0.3.0")).toBe(false);
    expect(satisfiesVersionRange("~1.2.0", "1.2.9")).toBe(true);
    expect(satisfiesVersionRange("~1.2.0", "1.3.0")).toBe(false);
    expect(satisfiesVersionRange(">=1.0.0", "3.0.0")).toBe(true);
    expect(satisfiesVersionRange("1.0.0", "1.0.0")).toBe(true);
    expect(satisfiesVersionRange("1.0.0", "1.0.1")).toBe(false);
    expect(satisfiesVersionRange("latest", "1.0.0")).toBe(false);
  });
});

describe("component manifest surfaces (G17)", () => {
  it("lists only known surfaces and gives every module the dock, floating and window surfaces", () => {
    for (const m of manifests) for (const s of m.surfaces) expect(SURFACE_IDS).toContain(s);
    for (const m of manifests.filter((x) => x.kind === "module")) {
      expect(m.surfaces, m.id).toEqual(expect.arrayContaining(["dock", "floating", "window"]));
    }
  });

  it("gives a widget surface to dashboard modules only", () => {
    expect(manifests.find((m) => m.id === "tasks")!.surfaces).toContain("widget");
    expect(manifests.find((m) => m.id === "inventory")!.surfaces).not.toContain("widget");
  });
});
