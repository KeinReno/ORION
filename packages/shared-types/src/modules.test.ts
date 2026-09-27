import { describe, expect, it } from "vitest";
import {
  effectiveDisabledModules,
  INBOX_TARGET_MODULE,
  isModuleEnabled,
  isModuleRestricted,
  isOrionModuleId,
  MODULE_CATALOG,
  moduleStates,
  ORION_MODULE_IDS,
  SEARCH_TYPE_MODULE,
  setWorkspaceModuleInputSchema
} from "./modules";

describe("module registry", () => {
  it("lists each catalog id exactly once and covers ORION_MODULE_IDS", () => {
    const ids = MODULE_CATALOG.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...ORION_MODULE_IDS].sort());
  });

  it("treats a missing disabled list as everything enabled", () => {
    expect(isModuleEnabled(undefined, "habits")).toBe(true);
    expect(isModuleEnabled([], "finance")).toBe(true);
  });

  it("turns a module off without affecting its neighbours", () => {
    const disabled = ["habits"];
    expect(isModuleEnabled(disabled, "habits")).toBe(false);
    expect(isModuleEnabled(disabled, "tasks")).toBe(true);
    const states = moduleStates(disabled, []);
    expect(states.find((item) => item.id === "habits")?.enabled).toBe(false);
    expect(states.find((item) => item.id === "tasks")?.enabled).toBe(true);
  });

  it("restricts a module without disabling it", () => {
    const restricted = ["finance"];
    expect(isModuleRestricted(restricted, "finance")).toBe(true);
    expect(isModuleRestricted(restricted, "tasks")).toBe(false);
    expect(isModuleRestricted(undefined, "finance")).toBe(false);
    const states = moduleStates([], restricted);
    const finance = states.find((item) => item.id === "finance");
    expect(finance).toMatchObject({ enabled: true, restricted: true });
  });

  it("hides restricted modules from a plain member but not from owner/lead", () => {
    const workspace = { disabledModules: ["inventory"], restrictedModules: ["finance"] };
    expect(effectiveDisabledModules({ ...workspace, role: "member" })).toEqual(
      expect.arrayContaining(["inventory", "finance"])
    );
    expect(effectiveDisabledModules({ ...workspace, role: "owner" })).toEqual(["inventory"]);
    expect(effectiveDisabledModules({ ...workspace, role: "lead" })).toEqual(["inventory"]);
  });

  it("does not treat unknown ids as modules", () => {
    expect(isOrionModuleId("dashboard")).toBe(false);
    expect(isOrionModuleId("inbox")).toBe(false);
    expect(isOrionModuleId("habits")).toBe(true);
  });

  it("maps searchable types and inbox targets onto domain modules", () => {
    expect(SEARCH_TYPE_MODULE.transaction).toBe("finance");
    expect(SEARCH_TYPE_MODULE.event).toBe("calendar");
    expect(INBOX_TARGET_MODULE.task).toBe("tasks");
  });

  it("accepts an enable flag without inventing a default", () => {
    expect(setWorkspaceModuleInputSchema.safeParse({}).success).toBe(false);
    expect(setWorkspaceModuleInputSchema.parse({ enabled: false })).toEqual({ enabled: false });
  });

  it("gives every catalog entry a disable page: owns, lives without, disable behavior", () => {
    for (const item of MODULE_CATALOG) {
      expect(item.required).toBe(false);
      expect(item.owns.length).toBeGreaterThan(10);
      expect(item.livesWithout.length).toBeGreaterThan(10);
      expect(item.disableBehavior.length).toBeGreaterThan(10);
      expect(item.optionalDependencies.includes(item.id)).toBe(false);
    }
  });
});
