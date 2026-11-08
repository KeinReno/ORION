import type { UserPreference, Workspace } from "@orion/shared-types";
import { PRECISION_THEME, THEME_PRESETS, parseThemeDocument, type ThemeDocument } from "@orion/ui";
import { PRECISION_ONLY } from "./orion-edition";

export type ThemeSource = "workspace" | "personal" | "default";

/**
 * Which palette the app shows, highest first: (an unsaved preview is a nested scope, never this) → the
 * workspace theme, unless the user chose "always mine" → the user's chosen preset or own theme → Precision.
 * Anything unknown, deleted or damaged falls through to the next layer, so the result is always a palette and
 * never depends on a write. In ORION Rust the shell is Precision even if a saved preference still says otherwise.
 * `precisionOnly: false` keeps the old split, where a legacy shell has no Precision palette.
 */
export function resolveApplicationTheme(
  preferences: UserPreference | undefined,
  workspace?: Pick<Workspace, "theme"> | null,
  options?: { precisionOnly?: boolean }
): { theme: ThemeDocument; source: ThemeSource } | undefined {
  const precisionOnly = options?.precisionOnly ?? PRECISION_ONLY;
  if (!precisionOnly && preferences?.theme !== "kaiden-precision") return undefined;
  if (!preferences) return undefined;
  if (workspace?.theme && preferences.workspaceThemeMode !== "personal") {
    const parsed = parseThemeDocument(workspace.theme);
    if (parsed.ok) return { theme: parsed.value, source: "workspace" };
  }
  const own = findTheme(preferences, preferences.activeThemeId);
  if (own) return { theme: own, source: "personal" };
  return { theme: PRECISION_THEME, source: "default" };
}

export function effectiveApplicationTheme(
  preferences: UserPreference | undefined,
  workspace?: Pick<Workspace, "theme"> | null,
  options?: { precisionOnly?: boolean }
): ThemeDocument | undefined {
  return resolveApplicationTheme(preferences, workspace, options)?.theme;
}

/** A built-in preset or an own theme by id; own themes are looked up first so a library entry is never shadowed. */
export function findTheme(preferences: Pick<UserPreference, "themeLibrary"> | undefined, id: string | null | undefined): ThemeDocument | null {
  if (!id) return null;
  const entry = preferences?.themeLibrary?.find(e => e.document.id === id);
  if (entry) {
    const parsed = parseThemeDocument(entry.document);
    if (parsed.ok) return parsed.value;
  }
  return THEME_PRESETS.find(preset => preset.id === id) ?? null;
}
