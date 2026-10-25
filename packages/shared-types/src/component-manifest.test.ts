import { describe, expect, it } from "vitest";
import {
  COMPONENT_MANIFESTS,
  PLATFORM_API_VERSION,
  SURFACE_IDS,
  buildComponentManifests,
  componentManifestSchema,
  componentCompatibilityProblems,
  satisfiesVersionRange,
  unsatisfiedContracts
} from "./component-manifest";
import { CONTRACT_IDS, PLATFORM_CONTRACT_VERSIONS } from "./platform-contracts";
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
  it.each([
    ["^0.0.3", "0.0.3", true], ["^0.0.3", "0.0.4", false], ["^0.0.3", "0.1.0", false],
    ["^0.2.3", "0.2.9", true], ["^0.2.3", "0.3.0", false], ["^0.2.3", "0.2.2", false],
    ["^1.2.3", "1.9.0", true], ["^1.2.3", "2.0.0", false],
    ["~0.0.3", "0.0.4", true], ["0.0.3", "0.0.4", false], [">=0.0.3", "2.0.0", true],
    ["^01.0.0", "1.0.0", false], ["^1.0.0", "1.00.0", false],
    ["^1.0.0", "9007199254740993.0.0", false]
  ])("%s vs %s is %s", (range, version, result) => {
    expect(satisfiesVersionRange(range, version)).toBe(result);
  });
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

describe("component activation compatibility", () => {
  const base = COMPONENT_MANIFESTS.find(m => m.id === "tasks")!;
  const dependency = { ...base, id: "dep", version: "0.0.3", requires: { ...base.requires, modules: [] } };
  const subject = { ...base, id: "subject", requires: { ...base.requires, modules: ["dep"], moduleVersions: { dep: "^0.0.3" } } };
  it("accepts active compatible dependencies; optional neighbors do not gate activation", () => {
    expect(componentCompatibilityProblems("subject", new Set(["dep"]), [subject, dependency])).toEqual([]);
  });
  it("rejects missing, disabled and mismatched mandatory dependencies", () => {
    expect(componentCompatibilityProblems("subject", new Set(), [subject, dependency]).join()).toContain("включите модуль dep");
    expect(componentCompatibilityProblems("subject", new Set(["dep"]), [subject]).join()).toContain("не зарегистрирован");
    expect(componentCompatibilityProblems("subject", new Set(["dep"]), [subject, { ...dependency, version: "0.0.4" }]).join()).toContain("установлен 0.0.4");
  });
  it("checks transitive platform/contract compatibility and cycles", () => {
    expect(componentCompatibilityProblems("subject", new Set(["dep"]), [subject, { ...dependency, requires: { ...dependency.requires, platform: "^99.0.0" } }]).join()).toContain("нужна платформа");
    expect(componentCompatibilityProblems("subject", new Set(["dep"]), [subject, { ...dependency, requires: { ...dependency.requires, contracts: { event: "^99.0.0" } } }]).join()).toContain("несовместимый контракт");
    expect(componentCompatibilityProblems("subject", new Set(["dep", "subject"]), [subject, { ...dependency, requires: { ...dependency.requires, modules: ["subject"] } }]).join()).toContain("Цикл");
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

describe("contract versions (G2)", () => {
  it("has a semver for every contract id and a platform major not below any of them", () => {
    expect(Object.keys(PLATFORM_CONTRACT_VERSIONS).sort()).toEqual([...CONTRACT_IDS].sort());
    const platformMajor = Number(PLATFORM_API_VERSION.split(".")[0]);
    for (const id of CONTRACT_IDS) {
      expect(PLATFORM_CONTRACT_VERSIONS[id], id).toMatch(/^\d+\.\d+\.\d+$/);
      expect(Number(PLATFORM_CONTRACT_VERSIONS[id].split(".")[0]), id).toBeLessThanOrEqual(platformMajor);
    }
  });

  it("accepts requires.contracts only for known contracts and checks the ranges", () => {
    const base = manifests[0]!;
    const withContracts = (contracts: Record<string, string>) => ({ ...base, requires: { ...base.requires, contracts } });
    expect(componentManifestSchema.safeParse(withContracts({ event: "^1.0.0" })).success).toBe(true);
    expect(componentManifestSchema.safeParse(withContracts({ bogus: "^1.0.0" })).success).toBe(false);
    expect(componentManifestSchema.safeParse(withContracts({ event: "latest" })).success).toBe(false);
    expect(unsatisfiedContracts(withContracts({ event: "^1.0.0", plugin: "^1.0.0" }))).toEqual([]);
    expect(unsatisfiedContracts(withContracts({ event: "^2.0.0" }))).toEqual(["event"]);
    expect(unsatisfiedContracts(base)).toEqual([]);
  });
});
