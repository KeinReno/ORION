import { describe, expect, it } from "vitest";
import { themeDocumentSchema, updateUserPreferenceInputSchema, type UserPreference } from "@orion/shared-types";
import { ARCTIC_THEME, MIDNIGHT_THEME, PRECISION_THEME, exportThemeDocument } from "@orion/ui";
import { effectiveApplicationTheme, resolveApplicationTheme } from "./effective-application-theme";

describe("saved application palette", () => {
  it("keeps the UI format compatible with the public server contract", () => {
    for (const theme of [PRECISION_THEME, ARCTIC_THEME]) expect(themeDocumentSchema.parse(JSON.parse(exportThemeDocument(theme)))).toEqual(theme);
  });
  const prefs = (extra: object) => ({ theme: "kaiden-precision", themeLibrary: [], activeThemeId: null, workspaceThemeMode: "follow", ...extra }) as unknown as UserPreference;
  const own = { ...MIDNIGHT_THEME, id: "my-night", name: "Моя ночь" };
  const library = [{ document: own, updatedAt: "2026-10-17T00:00:00.000Z" }];
  const shared = { ...ARCTIC_THEME, id: "family", name: "Семья" };

  it("falls back safely for missing, unknown, corrupt and legacy-only preferences", () => {
    expect(effectiveApplicationTheme(undefined)).toBeUndefined();
    expect(effectiveApplicationTheme(prefs({}))).toEqual(PRECISION_THEME);
    expect(effectiveApplicationTheme(prefs({ activeThemeId: "deleted-theme" }))).toEqual(PRECISION_THEME);
    expect(effectiveApplicationTheme(prefs({ activeThemeId: "broken", themeLibrary: [{ document: { schemaVersion: 99, id: "broken" }, updatedAt: "2026-10-17T00:00:00.000Z" }] }))).toEqual(PRECISION_THEME);
    // The single legacy slot was migrated into the library; on its own it no longer decides the palette.
    expect(effectiveApplicationTheme(prefs({ customTheme: ARCTIC_THEME, customThemeEnabled: true }))).toEqual(PRECISION_THEME);
    expect(effectiveApplicationTheme(prefs({ theme: "dark", activeThemeId: "arctic" }))).toEqual(ARCTIC_THEME);
    expect(effectiveApplicationTheme(prefs({ theme: "dark", activeThemeId: "arctic" }), undefined, { precisionOnly: false })).toBeUndefined();
  });

  it("orders workspace override → personal choice → default, and respects «always mine»", () => {
    expect(effectiveApplicationTheme(prefs({ activeThemeId: "arctic" }))).toEqual(ARCTIC_THEME);
    expect(effectiveApplicationTheme(prefs({ activeThemeId: "my-night", themeLibrary: library }))).toEqual(own);
    expect(resolveApplicationTheme(prefs({ activeThemeId: "my-night", themeLibrary: library }), { theme: shared })).toEqual({ theme: shared, source: "workspace" });
    expect(resolveApplicationTheme(prefs({ activeThemeId: "my-night", themeLibrary: library, workspaceThemeMode: "personal" }), { theme: shared })).toEqual({ theme: own, source: "personal" });
    expect(resolveApplicationTheme(prefs({}), { theme: null })).toEqual({ theme: PRECISION_THEME, source: "default" });
    // A damaged workspace document never blanks the app: the member's own choice shows.
    expect(effectiveApplicationTheme(prefs({ activeThemeId: "arctic" }), { theme: { ...shared, colors: { ...shared.colors, accent: "red" } } as never })).toEqual(ARCTIC_THEME);
  });
  it("requires document and activation together, while old patches stay valid", () => {
    expect(updateUserPreferenceInputSchema.safeParse({ accent: "blue" }).success).toBe(true);
    expect(updateUserPreferenceInputSchema.safeParse({ customThemeEnabled: true }).success).toBe(false);
    expect(updateUserPreferenceInputSchema.safeParse({ customTheme: null, customThemeEnabled: true }).success).toBe(false);
    expect(updateUserPreferenceInputSchema.safeParse({ customTheme: ARCTIC_THEME, customThemeEnabled: true }).success).toBe(true);
    expect(themeDocumentSchema.safeParse({ ...ARCTIC_THEME, colors: { ...ARCTIC_THEME.colors, accent: "var(--unsafe)" } }).success).toBe(false);
  });
});
