"use client";

import { createContext, useContext, useMemo, type CSSProperties, type HTMLAttributes } from "react";
import { DESIGN_SYSTEM_VERSION, THEME_FOUNDATION_FLAG, resolveTheme, themeVariables, type ThemeId, type ThemeVariables } from "./design-tokens";
import { parseThemeDocument, themeDocumentVariables } from "./theme-engine";

export interface ThemeContextValue {
  schemaVersion: typeof DESIGN_SYSTEM_VERSION;
  theme: string;
  variables: Readonly<ThemeVariables>;
  colorScheme?: "dark" | "light";
}

const DEFAULT_THEME_CONTEXT: ThemeContextValue = {
  schemaVersion: DESIGN_SYSTEM_VERSION,
  theme: "legacy",
  variables: themeVariables("legacy")
};
const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Read effective scoped tokens through @orion/ui, without importing an app theme manager. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext) ?? DEFAULT_THEME_CONTEXT;
}

/** Apply to an existing portal root so it inherits the React owner's theme without a layout wrapper. */
export function useThemeScopeProps(): {
  style?: CSSProperties & ThemeVariables;
  "data-kaiden-theme"?: string;
  "data-kaiden-version"?: typeof DESIGN_SYSTEM_VERSION;
} {
  const context = useContext(ThemeContext);
  return useMemo(() => context ? {
    style: { ...context.variables, ...(context.colorScheme ? { colorScheme: context.colorScheme } : {}) },
    "data-kaiden-theme": context.theme,
    "data-kaiden-version": context.schemaVersion
  } : {}, [context]);
}

/**
 * Explicit opt-in scope, never writes html, storage or user/workspace settings.
 * `flag="kaiden-theme-v1" theme="kaiden-precision"` enables the candidate palette.
 * Removing the flag restores legacy values, including the user's current accent.
 * The host owns layout through className. Shared overlays carry the scope across their portals.
 * Custom plugin portals can apply useThemeScopeProps() to their existing root.
 */
export function ThemeProvider({ flag, theme, definition, inherit = false, style, children, ...props }: HTMLAttributes<HTMLDivElement> & {
  flag?: string;
  theme?: ThemeId;
  /** Data-only v1 document. Invalid input keeps the selected built-in/legacy fallback. */
  definition?: unknown;
  /** Restore the owner's effective theme without unmounting a preview's children. */
  inherit?: boolean;
}): React.ReactElement {
  const parent = useContext(ThemeContext);
  const effectiveTheme = resolveTheme(flag, theme);
  const context = useMemo(() => {
    if (inherit && parent) return parent;
    const parsed = flag === THEME_FOUNDATION_FLAG ? parseThemeDocument(definition) : null;
    return {
      schemaVersion: DESIGN_SYSTEM_VERSION,
      theme: parsed?.ok ? parsed.value.id : effectiveTheme,
      variables: parsed?.ok ? themeDocumentVariables(parsed.value) : themeVariables(effectiveTheme),
      colorScheme: parsed?.ok ? parsed.value.baseMode : undefined
    };
  }, [definition, effectiveTheme, flag, inherit, parent]);
  return (
    <ThemeContext.Provider value={context}>
      <div {...props} data-kaiden-theme={context.theme} data-kaiden-version={DESIGN_SYSTEM_VERSION}
        style={{ ...style, ...context.variables, ...(context.colorScheme ? { colorScheme: context.colorScheme } : {}) }}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
