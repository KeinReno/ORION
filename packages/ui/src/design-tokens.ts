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
  "text-subtle": "138 138 148",
  "tint-base": "255 255 255",
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

/** Existing Tailwind/rem scales: additive primitives, independent of theme and density. */
export const PRIMITIVE_TOKENS = {
  "space-0": "0px",
  "space-0-5": "0.125rem",
  "space-1": "0.25rem",
  "space-2": "0.5rem",
  "space-3": "0.75rem",
  "space-4": "1rem",
  "space-5": "1.25rem",
  "space-6": "1.5rem",
  "space-8": "2rem",
  "space-12": "3rem",
  "radius-6": "0.375rem",
  "radius-8": "0.5rem",
  "radius-12": "0.75rem",
  "radius-16": "1rem",
  "type-display": "var(--font-display, 1.5rem)",
  "type-title": "var(--font-title, 1.125rem)",
  "type-body": "var(--font-body, 0.9375rem)",
  "type-label": "var(--font-label, 0.8125rem)",
  "type-micro": "var(--font-micro, 0.6875rem)"
} as const;

export const COMPONENT_TOKEN_ALIASES = {
  "button-bg": "var(--kaiden-accent-base)",
  "button-fg": "var(--kaiden-accent-foreground)",
  "button-radius": "var(--kaiden-radius-8)",
  "tab-radius": "var(--kaiden-radius-6)",
  "panel-header-bg": "var(--kaiden-bg-surface)",
  "panel-padding": "var(--kaiden-space-6)",
  "panel-gap": "var(--kaiden-space-6)",
  "overlay-bg": "var(--kaiden-bg-elevated)",
  "overlay-border": "var(--kaiden-border-default)",
  "inspector-bg": "var(--kaiden-bg-elevated)",
  "inspector-border": "var(--kaiden-border-default)",
  "item-hover": "var(--kaiden-bg-hover)"
} as const;

/** Candidate palette, opt-in only; full theme/module acceptance belongs to phase 2. */
export const PRECISION_TOKENS: DesignTokens = {
  ...LEGACY_TOKENS,
  "bg-canvas": "15 16 18",
  "bg-surface": "22 23 26",
  "bg-elevated": "29 30 34",
  "bg-hover": "39 40 45",
  "text-primary": "242 240 234",
  "text-secondary": "178 176 169",
  "text-subtle": "166 164 159",
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
  for (const [name, value] of Object.entries(PRIMITIVE_TOKENS)) variables[`--kaiden-${name}`] = value;
  // Rebind aliases in every scope: CSS variable references resolve at their declaration node.
  for (const [name, value] of Object.entries(COMPONENT_TOKEN_ALIASES)) variables[`--kaiden-${name}`] = value;
  return variables;
}
