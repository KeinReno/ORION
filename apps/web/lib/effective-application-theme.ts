import type { UserPreference } from "@orion/shared-types";
import { PRECISION_THEME, parseThemeDocument, type ThemeDocument } from "@orion/ui";

/** Palette and shell are distinct. Legacy mode retains its saved palette for a later return. */
export function effectiveApplicationTheme(preferences: UserPreference | undefined): ThemeDocument | undefined {
  if (preferences?.theme !== "kaiden-precision") return undefined;
  if (preferences.customThemeEnabled) {
    const parsed = parseThemeDocument(preferences.customTheme);
    if (parsed.ok) return parsed.value;
  }
  return PRECISION_THEME;
}
