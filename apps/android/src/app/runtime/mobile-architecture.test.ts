import { expect, it } from "vitest";
import { parseRoute, routeHash, type AppRoute } from "../navigation/routes";
import { SETTINGS_PAGES, SETTINGS_FIELDS, searchSettings } from "../settings/catalog";
import { createModuleRegistry, type MobileModuleDefinition } from "./module-registry";
it("roundtrips module scope, detail and settings field routes without credentials", () => {
  const routes: AppRoute[] = [{ kind: "module", moduleId: "lists", scope: "phone", entityId: crypto.randomUUID() }, { kind: "module", moduleId: "tasks", scope: "a".repeat(64) }, { kind: "settings", page: "motion", field: "depth-strength" }, { kind: "settings", query: "тёмная тема" }, { kind: "more" }];
  for (const route of routes) expect(parseRoute(routeHash(route))).toEqual(route);
  expect(parseRoute("#/scope/wrong/module/tasks")).toEqual({ kind: "module", moduleId: "unavailable" });
  expect(parseRoute("#/module/%broken")).toEqual({ kind: "module", moduleId: "tasks" });
  expect(parseRoute("#/settings/nonexistent").kind).toBe("settings");
});
it("indexes real settings pages and parameter anchors including ё", () => {
  expect(new Set(SETTINGS_FIELDS.map((field) => field.id)).size).toBe(SETTINGS_FIELDS.length);
  expect(new Set(SETTINGS_PAGES.map((page) => page.id)).size).toBe(SETTINGS_PAGES.length);
  for (const field of SETTINGS_FIELDS) expect(SETTINGS_PAGES.some((page) => page.id === field.page)).toBe(true);
  expect(searchSettings("темная").map((field) => field.id)).toContain("dark-theme");
  expect(searchSettings("наклон").map((field) => field.id)).toContain("depth-strength");
  expect(searchSettings("   ")).toEqual([]);
});
it("accepts another canonical module without shell changes and rejects duplicate or unknown owners", () => {
  const fixture: MobileModuleDefinition = { id: "calendar", label: "Календарь", icon: SETTINGS_PAGES[0].icon, summary: "fixture", render: () => null };
  expect(createModuleRegistry([fixture])[0].id).toBe("calendar");
  expect(() => createModuleRegistry([fixture, fixture])).toThrow();
  expect(() => createModuleRegistry([{ ...fixture, id: "unknown" } as never])).toThrow();
});
