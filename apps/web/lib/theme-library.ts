import { ApiError } from "@orion/core";
import { THEME_PRESET_IDS, themeRevisionConflictSchema, type ThemeLibraryEntry, type ThemeRevisionConflict, type UserPreference } from "@orion/shared-types";
import { THEME_PRESETS, type ThemeDocument } from "@orion/ui";

/** One row of the settings library: built-in presets first, then the account's own themes in saved order. */
export interface ThemeLibraryItem {
  theme: ThemeDocument;
  kind: "preset" | "own";
  /** Revision of an own theme (the save names it); null for presets. */
  updatedAt: string | null;
}

export function themeLibraryItems(preferences: Pick<UserPreference, "themeLibrary"> | undefined): ThemeLibraryItem[] {
  return [
    ...THEME_PRESETS.map(theme => ({ theme, kind: "preset" as const, updatedAt: null })),
    ...(preferences?.themeLibrary ?? []).map((entry: ThemeLibraryEntry) => ({ theme: entry.document as ThemeDocument, kind: "own" as const, updatedAt: entry.updatedAt }))
  ];
}

/** A fresh id that no preset and no own theme uses: `custom-<time>`, with a counter on the rare clash. */
export function newThemeId(taken: Iterable<string>, now: number = Date.now()): string {
  const used = new Set<string>([...THEME_PRESET_IDS, ...taken]);
  const base = `custom-${now.toString(36)}`;
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** A copy is a new own theme: new id, "— копия" name (within the 80-character limit), same colours. */
export function themeCopy(theme: ThemeDocument, taken: Iterable<string>, now?: number): ThemeDocument {
  return { ...theme, id: newThemeId(taken, now), name: `${theme.name} — копия`.slice(0, 80), colors: { ...theme.colors } };
}

/**
 * An imported file keeps its id unless that would overwrite something: a preset id or an own theme already in the
 * library gets a new id, so importing never replaces a saved theme silently.
 */
export function importedTheme(theme: ThemeDocument, taken: Iterable<string>, now?: number): ThemeDocument {
  const used = new Set<string>([...THEME_PRESET_IDS, ...taken]);
  return used.has(theme.id) ? { ...theme, id: newThemeId(used, now) } : theme;
}

/** The 409 of PUT settings/themes/:id, or null for any other failure. */
export function themeConflict(error: unknown): ThemeRevisionConflict | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const parsed = themeRevisionConflictSchema.safeParse(error.details);
  return parsed.success ? parsed.data : null;
}

/** Same colours, name and base: used to show which library row a workspace theme came from. */
export function sameTheme(a: ThemeDocument | null | undefined, b: ThemeDocument | null | undefined): boolean {
  if (!a || !b) return false;
  return a.id === b.id && a.name === b.name && a.baseMode === b.baseMode &&
    (Object.keys(a.colors) as Array<keyof ThemeDocument["colors"]>).every(key => a.colors[key] === b.colors[key]);
}
