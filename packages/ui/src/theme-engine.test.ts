import { describe, expect, it } from "vitest";
import { PRECISION_TOKENS } from "./design-tokens";
import { ARCTIC_THEME, MAX_THEME_JSON_LENGTH, PRECISION_THEME, exportThemeDocument, parseThemeDocument, resolveThemeDocument, themeBlockingContrastIssue, themeContrastChecks, themeDocumentVariables, themeTextContrast, withThemeColor } from "./theme-engine";

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
    expect(variables["--kaiden-panel-padding"]).toBe("var(--kaiden-space-5)");
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

import { THEME_PRESETS, contrastRatio } from "./theme-engine";

describe("built-in presets meet the contrast rules of 04_DESIGN_SYSTEM_THEMES", () => {
  it("has unique ids and roundtrips every preset", () => {
    expect(new Set(THEME_PRESETS.map(t => t.id)).size).toBe(THEME_PRESETS.length);
    expect(THEME_PRESETS.map(t => t.id)).toEqual(expect.arrayContaining(["kaiden-precision", "obsidian", "arctic", "midnight", "emerald", "crimson"]));
    for (const theme of THEME_PRESETS) expect(parseThemeDocument(exportThemeDocument(theme))).toEqual({ ok: true, value: theme });
  });
  describe.each(THEME_PRESETS.map(t => [t.name, t] as const))("%s", (_name, t) => {
    const c = t.colors;
    it("text is >= 4.5:1 on every surface, including hover", () => {
      for (const text of [c.textPrimary, c.textSecondary, c.textSubtle]) for (const bg of [c.canvas, c.surface, c.elevated, c.hover]) {
        expect(contrastRatio(text, bg), `${text} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it("accent text/controls: accent on surface >= 3, foreground on accent and hover >= 4.5, focus ring >= 3", () => {
      expect(contrastRatio(c.accent, c.surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c.accentForeground, c.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.accentForeground, c.accentHover)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.focus, c.surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c.focus, c.canvas)).toBeGreaterThanOrEqual(3);
    });
    it("status colors and strong borders are >= 3:1 on the surface", () => {
      for (const color of [c.success, c.warning, c.danger, c.info, c.borderStrong]) expect(contrastRatio(color, c.surface), color).toBeGreaterThanOrEqual(3);
    });
    it("mode matches the canvas luminance", () => {
      const dark = contrastRatio(c.canvas, "#000000") < contrastRatio(c.canvas, "#ffffff");
      expect(dark).toBe(t.baseMode === "dark");
    });
  });
});

describe("palette drives the app's accent and status colours", () => {
  it("emits the legacy --orion-* channels from the document", () => {
    const light = themeDocumentVariables(ARCTIC_THEME);
    expect(light["--orion-accent"]).toBe("48 92 140");
    expect(light["--orion-accent-hover"]).toBe("36 71 110");
    expect(light["--orion-accent-foreground"]).toBe("255 255 255");
    expect(light["--orion-warning"]).toBe("146 91 16");
    expect(light["--orion-warning-hover"]).toBe("146 91 16"); // no dark-theme lightening on a light surface
    expect(light["--orion-tag-l"]).toBe("25%");
    expect(light["--orion-tone-scale"]).toBe("0.3");
    expect(themeDocumentVariables(PRECISION_THEME)["--orion-tag-l"]).toBe("78%");
  });
  it("leaves Precision exactly at the dark defaults", () => {
    const dark = themeDocumentVariables(PRECISION_THEME);
    expect(dark["--orion-accent"]).toBe("201 168 106");
    expect(dark["--orion-accent-hover"]).toBe("222 192 139");
    expect([dark["--orion-success"], dark["--orion-warning"], dark["--orion-danger"]]).toEqual(["16 185 129", "245 158 11", "251 113 133"]);
    expect(dark["--orion-warning-hover"]).toBeUndefined(); // the dark hover defaults stay
    expect(dark["--orion-danger-fill"]).toBe("207 66 77"); // = the globals.css default
  });
  it("keeps red text and the white-on-red badge readable in every preset", () => {
    const hex = (channels: string) => "#" + channels.split(" ").map(n => Number(n).toString(16).padStart(2, "0")).join("");
    for (const theme of THEME_PRESETS) {
      const vars = themeDocumentVariables(theme);
      expect(contrastRatio(hex(vars["--orion-danger"]), theme.colors.surface), theme.id).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio("#ffffff", hex(vars["--orion-danger-fill"])), theme.id).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("theme contrast checks", () => {
  it.each(THEME_PRESETS.map(theme => [theme.name, theme] as const))("every blocking pair of %s passes", (_name, theme) => {
    expect(themeBlockingContrastIssue(theme)).toBeNull();
    expect(themeContrastChecks(theme).filter(check => check.blocking).every(check => check.ok)).toBe(true);
  });
  it("blocks unreadable body text and an unreadable accent button, but only warns on muted pairs", () => {
    const grey = withThemeColor(PRECISION_THEME, "textPrimary", "#3a3b40");
    expect(themeBlockingContrastIssue(grey)).toMatch(/^Основной текст на поверхности/);
    const button = { ...PRECISION_THEME, colors: { ...PRECISION_THEME.colors, accentForeground: "#c0a060" } };
    expect(themeBlockingContrastIssue(button)).toMatch(/^Текст на кнопке акцента/);
    const muted = { ...PRECISION_THEME, colors: { ...PRECISION_THEME.colors, textSubtle: "#3a3b40" } };
    expect(themeBlockingContrastIssue(muted)).toBeNull();
    expect(themeContrastChecks(muted).find(check => check.id === "subtle-surface")).toMatchObject({ ok: false, blocking: false });
  });
});
