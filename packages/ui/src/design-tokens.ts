/** Public, versioned visual contract. Values are RGB channels for Tailwind opacity support. */
export const DESIGN_SYSTEM_VERSION = 1 as const;
export const THEME_FOUNDATION_FLAG = "kaiden-theme-v1" as const;
export type ThemeId = "legacy" | "kaiden-precision";

export const LEGACY_TOKENS = {
  "bg-canvas": "10 10 12",
  "bg-surface": "13 13 17",
  "bg-elevated": "20 20 25",
  "bg-hover": "26 26 33",
  "text-primary": "244 244 245",
  "text-secondary": "161 161 170",
  "border-default": "44 44 53",
  "border-strong": "60 60 71",
  "accent-base": "var(--orion-accent, 91 94 232)",
  "accent-hover": "var(--orion-accent-hover, 124 127 243)",
  "accent-foreground": "var(--orion-accent-foreground, 255 255 255)",
  "focus-ring": "var(--orion-accent, 91 94 232)",
  "status-success": "var(--orion-success, 16 185 129)",
  "status-warning": "var(--orion-warning, 245 158 11)",
  "status-danger": "var(--orion-danger, 244 63 94)",
  "status-info": "96 165 250",
  "interactive-selected": "var(--orion-accent, 91 94 232)"
} as const;
export type DesignToken = keyof typeof LEGACY_TOKENS;
export type DesignTokens = Readonly<Record<DesignToken, string>>;

/** Candidate palette, opt-in only; full theme/module acceptance belongs to phase 2. */
export const PRECISION_TOKENS: DesignTokens = {
  ...LEGACY_TOKENS,
  "bg-canvas": "15 16 18",
  "bg-surface": "22 23 26",
  "bg-elevated": "29 30 34",
  "bg-hover": "39 40 45",
  "text-primary": "242 240 234",
  "text-secondary": "178 176 169",
  "border-default": "65 66 72",
  "border-strong": "98 99 106",
  "accent-base": "201 168 106",
  "accent-hover": "222 192 139",
  "accent-foreground": "22 23 26",
  "focus-ring": "222 192 139",
  "interactive-selected": "201 168 106"
};

/** No preference migration or persistence: unknown flags/IDs safely keep the current UI. */
export function resolveTheme(flag: unknown, theme: unknown): ThemeId {
  return flag === THEME_FOUNDATION_FLAG && theme === "kaiden-precision" ? "kaiden-precision" : "legacy";
}

export type ThemeVariables = Record<`--kaiden-${string}`, string>;

export function themeVariables(theme: ThemeId): ThemeVariables {
  const tokens = theme === "kaiden-precision" ? PRECISION_TOKENS : LEGACY_TOKENS;
  const variables: ThemeVariables = { "--kaiden-schema-version": String(DESIGN_SYSTEM_VERSION) };
  for (const [name, value] of Object.entries(tokens)) variables[`--kaiden-${name}`] = value;
  // Component aliases remain connected to semantic roles, including during a scoped preview.
  variables["--kaiden-button-bg"] = "var(--kaiden-accent-base)";
  variables["--kaiden-button-fg"] = "var(--kaiden-accent-foreground)";
  variables["--kaiden-panel-header-bg"] = "var(--kaiden-bg-surface)";
  return variables;
}
