import { describe, expect, it } from "vitest";
import { ApiError } from "@orion/core";
import { THEME_PRESET_IDS } from "@orion/shared-types";
import { ARCTIC_THEME, PRECISION_THEME, THEME_PRESETS } from "@orion/ui";
import { importedTheme, newThemeId, sameTheme, themeConflict, themeCopy, themeLibraryItems } from "./theme-library";

describe("theme library helpers", () => {
  it("lists presets first, then own themes in saved order", () => {
    const own = { ...ARCTIC_THEME, id: "mine", name: "Моя" };
    const items = themeLibraryItems({ themeLibrary: [{ document: own, updatedAt: "2026-10-17T00:00:00.000Z" }] });
    expect(items.map(i => i.kind)).toEqual([...THEME_PRESETS.map(() => "preset"), "own"]);
    expect(items.at(-1)).toMatchObject({ theme: own, updatedAt: "2026-10-17T00:00:00.000Z" });
  });

  it("keeps the shared preset id list in step with the UI presets", () => {
    expect([...THEME_PRESET_IDS].sort()).toEqual(THEME_PRESETS.map(p => p.id).sort());
  });

  it("never reuses a preset or own id for copies and imports", () => {
    const now = 1_700_000_000_000;
    const base = `custom-${now.toString(36)}`;
    expect(newThemeId([], now)).toBe(base);
    expect(newThemeId([base], now)).toBe(`${base}-2`);
    const copy = themeCopy({ ...PRECISION_THEME, name: "Я".repeat(80) }, [], now);
    expect(copy.id).toBe(base);
    expect(copy.name).toHaveLength(80);
    expect(importedTheme(ARCTIC_THEME, [], now).id).toBe(base);
    expect(importedTheme({ ...ARCTIC_THEME, id: "mine" }, ["mine"], now).id).toBe(base);
    expect(importedTheme({ ...ARCTIC_THEME, id: "fresh" }, ["mine"], now).id).toBe("fresh");
  });

  it("recognises only a well-formed revision conflict", () => {
    const current = { document: ARCTIC_THEME, updatedAt: "2026-10-17T00:00:00.000Z" };
    expect(themeConflict(new ApiError(409, "x", { code: "theme_revision_conflict", current }))).toEqual({ code: "theme_revision_conflict", current });
    expect(themeConflict(new ApiError(409, "x", { code: "theme_revision_conflict", current: null }))).toEqual({ code: "theme_revision_conflict", current: null });
    expect(themeConflict(new ApiError(409, "x", { code: "other" }))).toBeNull();
    expect(themeConflict(new ApiError(500, "x", { code: "theme_revision_conflict", current: null }))).toBeNull();
    expect(themeConflict(new Error("x"))).toBeNull();
  });

  it("matches a workspace copy to its library row only when everything is equal", () => {
    expect(sameTheme(ARCTIC_THEME, { ...ARCTIC_THEME, colors: { ...ARCTIC_THEME.colors } })).toBe(true);
    expect(sameTheme(ARCTIC_THEME, { ...ARCTIC_THEME, colors: { ...ARCTIC_THEME.colors, accent: "#000000" } })).toBe(false);
    expect(sameTheme(null, ARCTIC_THEME)).toBe(false);
  });
});
