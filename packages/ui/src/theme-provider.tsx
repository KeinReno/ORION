"use client";

import { createContext, useContext, useMemo, type HTMLAttributes } from "react";
import { DESIGN_SYSTEM_VERSION, resolveTheme, themeVariables, type ThemeId, type ThemeVariables } from "./design-tokens";

export interface ThemeContextValue {
  schemaVersion: typeof DESIGN_SYSTEM_VERSION;
  theme: ThemeId;
  variables: Readonly<ThemeVariables>;
}

const ThemeContext = createContext<ThemeContextValue>({
  schemaVersion: DESIGN_SYSTEM_VERSION,
  theme: "legacy",
  variables: themeVariables("legacy")
});

/** Read effective scoped tokens through @orion/ui, without importing an app theme manager. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/**
 * Explicit opt-in scope, never writes html, storage or user/workspace settings.
 * `flag="kaiden-theme-v1" theme="kaiden-precision"` enables the candidate palette.
 * Removing the flag restores legacy values, including the user's current accent.
 * The host owns layout through className; portalled content must be scoped separately.
 */
export function ThemeProvider({ flag, theme, style, children, ...props }: HTMLAttributes<HTMLDivElement> & {
  flag?: string;
  theme?: ThemeId;
}): React.ReactElement {
  const effectiveTheme = resolveTheme(flag, theme);
  const context = useMemo(() => ({
    schemaVersion: DESIGN_SYSTEM_VERSION,
    theme: effectiveTheme,
    variables: themeVariables(effectiveTheme)
  }), [effectiveTheme]);
  return (
    <ThemeContext.Provider value={context}>
      <div {...props} data-kaiden-theme={effectiveTheme} data-kaiden-version={DESIGN_SYSTEM_VERSION}
        style={{ ...style, ...context.variables }}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
