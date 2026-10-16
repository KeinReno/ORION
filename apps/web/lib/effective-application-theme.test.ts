import { describe, expect, it } from "vitest";
import { themeDocumentSchema, updateUserPreferenceInputSchema, type UserPreference } from "@orion/shared-types";
import { ARCTIC_THEME, PRECISION_THEME, exportThemeDocument } from "@orion/ui";
import { effectiveApplicationTheme } from "./effective-application-theme";

describe("saved application palette", () => {
  it("keeps the UI format compatible with the public server contract", () => {
    for (const theme of [PRECISION_THEME, ARCTIC_THEME]) expect(themeDocumentSchema.parse(JSON.parse(exportThemeDocument(theme)))).toEqual(theme);
  });
  it("falls back safely for old, disabled, corrupt and legacy preferences", () => {
    const prefs = (extra: object) => ({ theme: "kaiden-precision", ...extra }) as UserPreference;
    expect(effectiveApplicationTheme(undefined)).toBeUndefined();
    expect(effectiveApplicationTheme(prefs({}))).toEqual(PRECISION_THEME);
    expect(effectiveApplicationTheme(prefs({ customThemeEnabled: true, customTheme: { schemaVersion: 99 } }))).toEqual(PRECISION_THEME);
    expect(effectiveApplicationTheme(prefs({ customTheme: ARCTIC_THEME, customThemeEnabled: false }))).toEqual(PRECISION_THEME);
    expect(effectiveApplicationTheme(prefs({ customTheme: ARCTIC_THEME, customThemeEnabled: true }))).toEqual(ARCTIC_THEME);
    expect(effectiveApplicationTheme(prefs({ theme: "dark", customTheme: ARCTIC_THEME, customThemeEnabled: true }))).toBeUndefined();
  });
  it("requires document and activation together, while old patches stay valid", () => {
    expect(updateUserPreferenceInputSchema.safeParse({ accent: "blue" }).success).toBe(true);
    expect(updateUserPreferenceInputSchema.safeParse({ customThemeEnabled: true }).success).toBe(false);
    expect(updateUserPreferenceInputSchema.safeParse({ customTheme: null, customThemeEnabled: true }).success).toBe(false);
    expect(updateUserPreferenceInputSchema.safeParse({ customTheme: ARCTIC_THEME, customThemeEnabled: true }).success).toBe(true);
    expect(themeDocumentSchema.safeParse({ ...ARCTIC_THEME, colors: { ...ARCTIC_THEME.colors, accent: "var(--unsafe)" } }).success).toBe(false);
  });
});
