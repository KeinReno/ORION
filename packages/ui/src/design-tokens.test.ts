import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DESIGN_SYSTEM_VERSION, LEGACY_TOKENS, PRECISION_TOKENS, THEME_FOUNDATION_FLAG, resolveTheme, themeVariables } from "./design-tokens";
import { ThemeProvider, useTheme } from "./theme-provider";

describe("KAIDEN token foundation v1", () => {
  it("requires the exact versioned flag and known opt-in theme", () => {
    for (const flag of [undefined, null, true, "kaiden-theme-v2", ""]) {
      expect(resolveTheme(flag, "kaiden-precision")).toBe("legacy");
    }
    expect(resolveTheme(THEME_FOUNDATION_FLAG, "future-theme")).toBe("legacy");
    expect(resolveTheme(THEME_FOUNDATION_FLAG, "legacy")).toBe("legacy");
    expect(resolveTheme(THEME_FOUNDATION_FLAG, "kaiden-precision")).toBe("kaiden-precision");
  });

  it("keeps the host CSS bridge equal to the legacy contract, including dynamic user accents", () => {
    expect(LEGACY_TOKENS["accent-base"]).toContain("var(--orion-accent,");
    expect(LEGACY_TOKENS["accent-foreground"]).toContain("var(--orion-accent-foreground,");
    expect(LEGACY_TOKENS["bg-surface"]).toBe("13 13 17");
  });

  it("keeps status colors independent from the brand and connects component aliases", () => {
    for (const token of ["status-success", "status-warning", "status-danger", "status-info"] as const) {
      expect(PRECISION_TOKENS[token]).toBe(LEGACY_TOKENS[token]);
    }
    expect(themeVariables("kaiden-precision")["--kaiden-button-bg"]).toBe("var(--kaiden-accent-base)");
    expect(themeVariables("legacy")["--kaiden-schema-version"]).toBe(String(DESIGN_SYSTEM_VERSION));
  });

  it("keeps candidate text and button colors above 4.5:1 and the focus ring above 3:1", () => {
    const luminance = (rgb: string): number => rgb.split(" ").map(Number).map(n => {
      const s = n / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
    const contrast = (a: string, b: string): number => {
      const l = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (l[0] + 0.05) / (l[1] + 0.05);
    };
    for (const bg of ["bg-canvas", "bg-surface", "bg-elevated", "bg-hover"] as const) {
      for (const text of ["text-primary", "text-secondary"] as const) {
        expect(contrast(PRECISION_TOKENS[text], PRECISION_TOKENS[bg])).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(PRECISION_TOKENS["focus-ring"], PRECISION_TOKENS[bg])).toBeGreaterThanOrEqual(3);
    }
    for (const fill of ["accent-base", "accent-hover"] as const) {
      expect(contrast(PRECISION_TOKENS["accent-foreground"], PRECISION_TOKENS[fill])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("isolates sibling/nested scopes and resets to legacy when opt-in is removed", () => {
    function ReadTheme(): React.ReactElement {
      const context = useTheme();
      return createElement("output", null, `${context.schemaVersion}:${context.theme}`);
    }
    const legacy = createElement(ThemeProvider, { theme: "kaiden-precision" }, createElement(ReadTheme));
    const markup = renderToStaticMarkup(createElement("main", null,
      createElement(ThemeProvider, { flag: THEME_FOUNDATION_FLAG, theme: "kaiden-precision" }, createElement(ReadTheme), legacy),
      createElement(ReadTheme)));
    expect(markup.match(/1:kaiden-precision/g)).toHaveLength(1);
    expect(markup.match(/1:legacy/g)).toHaveLength(2);
    expect(markup).toContain("data-kaiden-theme=\"legacy\"");
    expect(markup).toContain("--kaiden-accent-base:201 168 106");
  });
});
