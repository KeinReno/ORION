import { z } from "zod";

/** v1 is data-only: bounded identifiers and literal hex colors; no CSS or executable values. */
const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
export const themeDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  name: z.string().trim().min(1).max(80),
  baseMode: z.enum(["dark", "light"]),
  colors: z.object({
    canvas: hex,
    surface: hex,
    elevated: hex,
    hover: hex,
    textPrimary: hex,
    textSecondary: hex,
    textSubtle: hex,
    border: hex,
    borderStrong: hex,
    accent: hex,
    accentHover: hex,
    accentForeground: hex,
    focus: hex,
    success: hex,
    warning: hex,
    danger: hex,
    info: hex,
    tint: hex,
  }).strict()
}).strict();
export type ThemeDocument = z.infer<typeof themeDocumentSchema>;

/** Ids of the built-in palettes (`THEME_PRESETS` in @orion/ui). A personal theme can never take one of them. */
export const THEME_PRESET_IDS = ["kaiden-precision", "obsidian", "midnight", "emerald", "crimson", "arctic"] as const;
export const DEFAULT_THEME_ID = "kaiden-precision";
/** How many own themes one account keeps; the library is one JSON value, so it stays small. */
export const THEME_LIBRARY_MAX = 24;

/** One own theme in the account library. `updatedAt` is the edit revision: a save names the one it started from. */
export const themeLibraryEntrySchema = z.object({
  document: themeDocumentSchema,
  updatedAt: z.string().datetime()
});
export type ThemeLibraryEntry = z.infer<typeof themeLibraryEntrySchema>;

/**
 * Whose palette wins when a workspace has its own: "follow" — the workspace theme (the default, so a shared
 * space looks the same for everyone); "personal" — always this user's own choice.
 */
export const workspaceThemeModeSchema = z.enum(["follow", "personal"]);
export type WorkspaceThemeMode = z.infer<typeof workspaceThemeModeSchema>;

/**
 * PUT settings/themes/:themeId. `expectedUpdatedAt` is the revision the editor loaded (`null` = "this is a new
 * theme"); a different stored revision is a 409 `theme_revision_conflict`. Omit it to overwrite deliberately.
 */
export const saveThemeInputSchema = z.object({
  document: themeDocumentSchema,
  expectedUpdatedAt: z.string().datetime().nullable().optional()
});
export type SaveThemeInput = z.infer<typeof saveThemeInputSchema>;

/** PUT workspaces/:id/theme — owner only. `null` removes the workspace theme; members fall back to their own. */
export const setWorkspaceThemeInputSchema = z.object({ theme: themeDocumentSchema.nullable() });
export type SetWorkspaceThemeInput = z.infer<typeof setWorkspaceThemeInputSchema>;

/** Body of the 409 from PUT settings/themes/:id. `current` is the stored version (null — it was deleted). */
export const themeRevisionConflictSchema = z.object({
  code: z.literal("theme_revision_conflict"),
  current: themeLibraryEntrySchema.nullable()
});
export type ThemeRevisionConflict = z.infer<typeof themeRevisionConflictSchema>;
