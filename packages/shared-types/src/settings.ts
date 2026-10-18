import { z } from "zod";
import { themeDocumentSchema, themeLibraryEntrySchema, workspaceThemeModeSchema } from "./theme-document";

// Existing values keep their original appearance; Precision is an explicit redesign opt-in.
export const themePreferenceSchema = z.enum(["system", "dark", "light", "kaiden-precision"]);
export const densityPreferenceSchema = z.enum(["compact", "comfortable"]);
/**
 * Decorative backdrop behind the app shell — "none" keeps the flat background.
 * "aurora"/"grid" are plain CSS; the other four are WebGL (OGL), heavier and
 * driven by `backgroundSpeed`/`backgroundColor`/`backgroundDensity` below.
 */
export const backgroundStylePreferenceSchema = z.enum([
  "none",
  "aurora",
  "grid",
  "liquid-ether",
  "light-pillar",
  "dark-veil",
  "shape-waves"
]);
export const WEBGL_BACKGROUND_STYLES = ["liquid-ether", "light-pillar", "dark-veil", "shape-waves"] as const;
export const backgroundIntensityPreferenceSchema = z.enum(["low", "medium", "high"]);
/** "glass" makes the sidebar/panels/cards translucent + blurred so backgroundStyle shows through — solid panels hide it entirely. */
export const surfaceStylePreferenceSchema = z.enum(["solid", "glass"]);

/**
 * Per-effect WebGL background config — one shape per variant, mirroring the
 * actual reactbits.dev prop set for that effect rather than a single shared
 * speed/density/color triple. Each variant keeps its own settings even while
 * another is active, so switching backgrounds and back doesn't lose tuning.
 */
export const liquidEtherConfigSchema = z.object({
  speed: z.number().min(0.1).max(3),
  color: z.string().nullable(),
  colorSecondary: z.string().nullable(),
  density: z.number().min(0.2).max(2),
  /** How strongly the flow reacts to the pointer; 0 = no pointer interaction. */
  mouseForce: z.number().min(0).max(1),
  /** Auto-animates without waiting for pointer movement (reactbits' autoDemo). */
  autoDemo: z.boolean()
});
export const lightPillarConfigSchema = z.object({
  speed: z.number().min(0.1).max(3),
  color: z.string().nullable(),
  density: z.number().min(0.2).max(2),
  pillarWidth: z.number().min(0.02).max(0.3),
  rayIntensity: z.number().min(0).max(1),
  flicker: z.number().min(0).max(1)
});
export const darkVeilConfigSchema = z.object({
  speed: z.number().min(0.1).max(3),
  color: z.string().nullable(),
  density: z.number().min(0.2).max(2),
  hueShift: z.number().min(0).max(360),
  warpAmount: z.number().min(0).max(2),
  scanlineIntensity: z.number().min(0).max(1)
});
export const shapeWavesConfigSchema = z.object({
  speed: z.number().min(0.1).max(3),
  color: z.string().nullable(),
  density: z.number().min(0.2).max(2),
  /** Gap between cells, as a fraction of cell size — 0 packs shapes edge to edge. */
  gap: z.number().min(0).max(0.4),
  waveAmplitude: z.number().min(0).max(1),
  shape: z.enum(["circle", "square"])
});
export const backgroundEffectSettingsSchema = z.object({
  "liquid-ether": liquidEtherConfigSchema,
  "light-pillar": lightPillarConfigSchema,
  "dark-veil": darkVeilConfigSchema,
  "shape-waves": shapeWavesConfigSchema
});
export type BackgroundEffectSettings = z.infer<typeof backgroundEffectSettingsSchema>;

export const DEFAULT_BACKGROUND_EFFECT_SETTINGS: BackgroundEffectSettings = {
  "liquid-ether": { speed: 1, color: null, colorSecondary: null, density: 1, mouseForce: 0.5, autoDemo: true },
  "light-pillar": { speed: 1, color: null, density: 1, pillarWidth: 0.07, rayIntensity: 0.35, flicker: 1 },
  "dark-veil": { speed: 1, color: null, density: 1, hueShift: 0, warpAmount: 1, scanlineIntensity: 0 },
  "shape-waves": { speed: 1, color: null, density: 1, gap: 0, waveAmplitude: 1, shape: "circle" }
};

/** A user-made folder in the left sidebar; `items` are panel ids (a panel is in at most one folder). */
export const SIDEBAR_FOLDERS_MAX = 12;
export const SIDEBAR_FOLDER_NAME_MAX = 40;
export const sidebarFolderSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(SIDEBAR_FOLDER_NAME_MAX),
  collapsed: z.boolean(),
  items: z.array(z.string().min(1).max(40)).max(60)
});
export type SidebarFolder = z.infer<typeof sidebarFolderSchema>;
export const sidebarFoldersSchema = z.array(sidebarFolderSchema).max(SIDEBAR_FOLDERS_MAX);

export const sidebarPositionSchema = z.enum(["left", "right", "top", "bottom"]);
export type SidebarPosition = z.infer<typeof sidebarPositionSchema>;
/** What a click on a menu section does to the tab strip: add a tab (they pile up) or replace the current one. */
export const openTabsModeSchema = z.enum(["accumulate", "replace"]);
export type OpenTabsMode = z.infer<typeof openTabsModeSchema>;
export const sidebarOrderSchema = z.array(z.string().min(1).max(40)).max(80);

export const userPreferenceSchema = z.object({
  theme: themePreferenceSchema,
  /**
   * Legacy single saved palette (before the theme library). Still accepted and returned for older clients on the
   * network; the current client reads `themeLibrary`/`activeThemeId`, and the migration copied it into the library.
   */
  customTheme: themeDocumentSchema.nullable().optional(),
  customThemeEnabled: z.boolean().optional(),
  /** The account's own themes. Changed only through PUT/DELETE settings/themes/:id, never through this PATCH. */
  themeLibrary: z.array(themeLibraryEntrySchema),
  /** Chosen palette: a built-in preset id or an id from `themeLibrary`; null = the default Precision palette. */
  activeThemeId: z.string().max(64).nullable(),
  workspaceThemeMode: workspaceThemeModeSchema,
  accent: z.enum(["violet", "blue", "green", "amber", "rose"]),
  density: densityPreferenceSchema,
  backgroundStyle: backgroundStylePreferenceSchema,
  backgroundIntensity: backgroundIntensityPreferenceSchema,
  backgroundEffectSettings: backgroundEffectSettingsSchema,
  targetCursorEnabled: z.boolean(),
  surfaceStyle: surfaceStylePreferenceSchema,
  /** 0.1–1 — panel/card/sidebar opacity in glass mode; replaces the old fixed 0.6/0.55/0.45 constants. */
  panelOpacity: z.number().min(0.1).max(1),
  /** 0–40 (px) — backdrop-filter blur radius in glass mode. */
  panelBlur: z.number().min(0).max(40),
  /** Hex or null — null follows the global accent; panels/cards can be tinted independently. */
  panelAccent: z.string().nullable(),
  timeZone: z.string().nullable(),
  weekStartsOn: z.number().int().min(0).max(1),
  desktopNotifications: z.boolean(),
  taskReminders: z.boolean(),
  eventReminders: z.boolean(),
  financeAlerts: z.boolean(),
  inventoryAlerts: z.boolean(),
  quietHoursStart: z.string().nullable(),
  quietHoursEnd: z.string().nullable(),
  dashboardWidgets: z.array(z.string()),
  /** Module ids hidden from this user's own sidebar — never affects the workspace or its data. */
  hiddenModules: z.array(z.string().max(40)).max(40),
  /** Show the short note id ("N-104") in the notes list and editor. Personal, off by default. */
  showNoteIds: z.boolean(),
  /** The user's own sidebar folders. Personal: other participants and the workspace are untouched. */
  sidebarFolders: sidebarFoldersSchema,
  /** The user's own order of sidebar sections (panel ids). Ids missing here keep their default place after the listed ones. */
  sidebarOrder: sidebarOrderSchema,
  /** Which edge of the window the menu sits on. Personal. */
  sidebarPosition: sidebarPositionSchema,
  /** Whether opening sections keeps adding tabs on top, or reuses the current tab. Personal. */
  openTabsMode: openTabsModeSchema,
  onboardingCompletedAt: z.string().datetime().nullable()
});
export type UserPreference = z.infer<typeof userPreferenceSchema>;

export const updateUserPreferenceInputSchema = userPreferenceSchema.omit({ themeLibrary: true }).partial().superRefine((input, ctx) => {
  // Enabling must carry the document atomically; a racing clear can never leave a dangling active theme.
  if (input.customThemeEnabled === true && !input.customTheme) {
    ctx.addIssue({ code: "custom", path: ["customTheme"], message: "Для применения передайте сохранённую палитру." });
  }
});
export type UpdateUserPreferenceInput = z.infer<typeof updateUserPreferenceInputSchema>;

/**
 * Quiet hours ("тихие часы") are stored as two `HH:MM` strings and mean "do
 * not deliver reminders inside this window". The logic lives here, in the
 * contract, because *both* sides need it and they must agree: the API gates
 * its Telegram/in-app notifications on it, and the desktop shell gates its
 * native toasts on it — two implementations would eventually drift.
 */

/** "23:00" / "9:05" / "23:00:00" → minutes since local midnight, or null if absent/invalid. */
export function parseClockMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Wall-clock minutes since midnight of `date` in `timeZone` (IANA name), or in
 * the host's zone when it is null/unknown. Deliberately `Intl`-based instead
 * of a date library: the project has no date dependency by design, and this is
 * the only place that needs a zone conversion.
 */
export function localMinutesOfDay(date: Date, timeZone: string | null | undefined): number {
  const format = (zone: string | undefined): Intl.DateTimeFormatPart[] =>
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = format(timeZone ?? undefined);
  } catch {
    // Unknown/garbage zone name — fall back rather than breaking every reminder.
    parts = format(undefined);
  }
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  // Some zones/locales report midnight as "24" with hour12:false.
  return ((hour % 24) * 60 + minute) % 1440;
}

/**
 * Is `date` inside the quiet window? Rules, all deliberate:
 *  - either bound missing/invalid → never quiet (an unset window must not
 *    silently mute everything);
 *  - equal bounds → never quiet (a zero-length window is not "all day");
 *  - `start > end` crosses midnight (23:00–07:00 covers 23:30 *and* 06:30).
 */
export function isWithinQuietHours(
  quietStart: string | null | undefined,
  quietEnd: string | null | undefined,
  date: Date,
  timeZone: string | null | undefined = null
): boolean {
  const from = parseClockMinutes(quietStart);
  const to = parseClockMinutes(quietEnd);
  if (from === null || to === null || from === to) return false;
  const now = localMinutesOfDay(date, timeZone);
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/**
 * U05 (24-CONNECTED-CORE-BACKLOG.md) — a sphere ("Дом"/"Работа"/"Учёба") is a
 * PERSONAL grouping of the user's own workspaces, not a new ownership
 * hierarchy: name/order/composition grant no rights to anyone
 * (23-UNIVERSAL-CONNECTED-CORE.md, "Иерархия и владение"). Server-computed
 * and returned already filtered to workspaces the caller is still a member
 * of — see `SettingsService.getOrganization`.
 */
export const workspaceSphereSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(60),
  order: z.number().int(),
  workspaceIds: z.array(z.string())
});
export type WorkspaceSphere = z.infer<typeof workspaceSphereSchema>;

/** GET .../settings/organization response — spheres + independent favorites, both per-user. */
export const workspaceOrganizationSchema = z.object({
  spheres: z.array(workspaceSphereSchema),
  favoriteWorkspaceIds: z.array(z.string())
});
export type WorkspaceOrganization = z.infer<typeof workspaceOrganizationSchema>;

export const createSphereInputSchema = z.object({ name: z.string().min(1).max(60) });
export type CreateSphereInput = z.infer<typeof createSphereInputSchema>;

export const updateSphereInputSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  order: z.number().int().optional()
});
export type UpdateSphereInput = z.infer<typeof updateSphereInputSchema>;

/**
 * Assigns (or, with `sphereId: null`, removes) a workspace's sphere for the
 * calling user. A workspace sits in at most one sphere per user in v1 — the
 * server drops it from any other sphere it was in before adding it to this
 * one, so the client never has to orchestrate that itself.
 */
export const assignWorkspaceSphereInputSchema = z.object({
  workspaceId: z.string(),
  sphereId: z.string().nullable()
});
export type AssignWorkspaceSphereInput = z.infer<typeof assignWorkspaceSphereInputSchema>;

export const setWorkspaceFavoriteInputSchema = z.object({ favorite: z.boolean() });
export type SetWorkspaceFavoriteInput = z.infer<typeof setWorkspaceFavoriteInputSchema>;

/** The Today card shows until the user dismisses it (or restores it from Settings). */
export function isOnboardingPending(pref: UserPreference | null | undefined): boolean {
  return pref != null && pref.onboardingCompletedAt === null;
}

export const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  environment: z.string(),
  apiVersion: z.string(),
  updateManifestUrl: z.string().nullable()
});
export type AppInfo = z.infer<typeof appInfoSchema>;

/**
 * S05 — public (no auth) mode readout for the client. The server already
 * rejects account-picker/PIN endpoints in "server" mode
 * (`apps/api/src/common/orion-mode.ts`); this is the matching UX signal so
 * `login`/`register` don't render controls the server will refuse anyway.
 * Not a secret and not itself an access-control boundary — hiding UI is a
 * usability nicety, the actual gate stays server-side.
 */
export const orionModeInfoSchema = z.object({ mode: z.enum(["local", "server"]) });
export type OrionModeInfo = z.infer<typeof orionModeInfoSchema>;
