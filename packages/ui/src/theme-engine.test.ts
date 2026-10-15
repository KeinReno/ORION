import { describe, expect, it } from "vitest";
import { PRECISION_TOKENS } from "./design-tokens";
import { ARCTIC_THEME, MAX_THEME_JSON_LENGTH, PRECISION_THEME, exportThemeDocument, parseThemeDocument, resolveThemeDocument, themeDocumentVariables, themeTextContrast, withThemeColor } from "./theme-engine";

describe("data-only theme engine v1", () => {
  it.each([PRECISION_THEME, ARCTIC_THEME])("roundtrips $name without changing colors", theme => {
    expect(parseThemeDocument(exportThemeDocument(theme))).toEqual({ ok: true, value: theme });
    expect(themeTextContrast(theme)).toBeGreaterThanOrEqual(4.5);
  });
  it("fills optional colors from the chosen base without mutating the preset", () => {
    const result = parseThemeDocument({ schemaVersion: 1, id: "my-theme", name: "  Mine  ", baseMode: "light", colors: { accent: "#AABBCC" } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.colors.accent).toBe("#aabbcc");
    expect(result.value.colors.canvas).toBe(ARCTIC_THEME.colors.canvas);
    expect(result.value.name).toBe("Mine");
    expect(ARCTIC_THEME.colors.accent).toBe("#305c8c");
  });
  it.each([
    "not JSON", "null", "[]", "{}", "x".repeat(MAX_THEME_JSON_LENGTH + 1),
    JSON.stringify({ ...PRECISION_THEME, schemaVersion: 2 }),
    JSON.stringify({ ...PRECISION_THEME, schemaVersion: 0 }),
    JSON.stringify({ ...PRECISION_THEME, css: "body{display:none}" }),
    JSON.stringify({ ...PRECISION_THEME, id: "../../theme" }),
    JSON.stringify({ ...PRECISION_THEME, name: " " }),
    JSON.stringify({ ...PRECISION_THEME, colors: { canvas: "url(https://example.test)" } }),
    JSON.stringify({ ...PRECISION_THEME, colors: { accent: "var(--other)" } }),
    JSON.stringify({ ...PRECISION_THEME, colors: { unknown: "#123456" } }),
    '{"schemaVersion":1,"id":"test","name":"Test","baseMode":"dark","colors":{"__proto__":"#112233"}}'
  ])("rejects invalid or executable input %#", input => {
    expect(parseThemeDocument(input).ok).toBe(false);
  });
  it("resolves preview > workspace > user > application, falling back from invalid layers", () => {
    const doc = (id: string) => ({ ...PRECISION_THEME, id });
    const layers = { application: doc("application"), user: doc("user"), workspace: doc("workspace"), preview: doc("preview") };
    expect(resolveThemeDocument(layers)?.id).toBe("preview");
    expect(resolveThemeDocument({ ...layers, preview: null })?.id).toBe("workspace");
    expect(resolveThemeDocument({ ...layers, preview: null, workspace: { schemaVersion: 99 } })?.id).toBe("user");
    expect(resolveThemeDocument({ application: layers.application })?.id).toBe("application");
    expect(resolveThemeDocument({})).toBeNull();
  });
  it("compiles only known channels and preserves component aliases, density and typography", () => {
    const variables = themeDocumentVariables(ARCTIC_THEME);
    expect(variables["--kaiden-bg-surface"]).toBe("255 255 255");
    expect(variables["--kaiden-focus-ring"]).toBe("48 92 140");
    expect(variables["--kaiden-button-bg"]).toBe("var(--kaiden-accent-base)");
    expect(variables["--kaiden-panel-padding"]).toBe("var(--kaiden-space-6)");
    expect(variables["--kaiden-type-body"]).toBe("var(--font-body, 0.9375rem)");
    const precision = themeDocumentVariables(PRECISION_THEME);
    for (const [name, value] of Object.entries(PRECISION_TOKENS)) {
      if (!value.startsWith("var(")) expect(precision[`--kaiden-${name}`]).toBe(value);
    }
  });
  it.each(["#777777", "#147866", "#f59e0b", "#fffffe", "#010101"])("keeps readable text on edited accent %s and hover without mutating the source", accent => {
    const edited = withThemeColor(PRECISION_THEME, "accent", accent);
    for (const surface of [edited.colors.accent, edited.colors.accentHover]) {
      expect(themeTextContrast({ ...edited, colors: { ...edited.colors, textPrimary: edited.colors.accentForeground, surface } })).toBeGreaterThanOrEqual(4.5);
    }
    expect(edited.colors.focus).toBe(edited.colors.accentHover);
    expect(PRECISION_THEME.colors.accent).toBe("#c9a86a");
  });
  it("rejects CSS in the color editor as well as in imports", () => {
    expect(() => withThemeColor(PRECISION_THEME, "accent", "url(https://example.test)")).toThrow();
    expect(() => themeDocumentVariables({ ...PRECISION_THEME, colors: { ...PRECISION_THEME.colors, accent: "var(--other)" } })).toThrow();
  });
});
