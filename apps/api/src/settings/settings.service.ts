import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  THEME_LIBRARY_MAX,
  THEME_PRESET_IDS,
  themeDocumentSchema,
  themeLibraryEntrySchema,
  workspaceThemeModeSchema,
  type SaveThemeInput,
  type ThemeLibraryEntry,
  DEFAULT_BACKGROUND_EFFECT_SETTINGS,
  sidebarFoldersSchema,
  sidebarOrderSchema,
  sidebarPositionSchema,
  openTabsModeSchema,
  motionLevelSchema,
  type BackgroundEffectSettings,
  type UpdateUserPreferenceInput,
  type UserPreference,
  type WorkspaceOrganization,
  type WorkspaceSphere
} from "@orion/shared-types";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { NotificationPolicyService } from "../notifications/notification-policy.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationPolicy: NotificationPolicyService,
    private readonly workspaces: WorkspacesService
  ) {}

  /**
   * The user's preference row, created on first use. Several first requests of a new session (preferences,
   * organization, …) arrive together and Prisma's upsert is not always a single atomic statement, so the
   * loser of that race got a unique-constraint 500. It now treats P2002 as "someone else just created it".
   */
  private async preferenceRow(userId: string, data: Prisma.UserPreferenceUncheckedUpdateInput = {}) {
    try {
      return await this.prisma.userPreference.upsert({
        where: { userId },
        create: { userId, ...data } as Prisma.UserPreferenceUncheckedCreateInput,
        update: data
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return this.prisma.userPreference.update({ where: { userId }, data });
      }
      throw error;
    }
  }

  async get(userId: string): Promise<UserPreference> {
    return toDto(await this.preferenceRow(userId));
  }

  async update(userId: string, input: UpdateUserPreferenceInput): Promise<UserPreference> {
    if (input.activeThemeId) {
      // The choice must name something that exists: a preset, or a theme already in this account's library.
      // Otherwise every device would silently fall back and the setting would look broken.
      const current = await this.preferenceRow(userId);
      if (!isPresetId(input.activeThemeId) && !parseLibrary(current.themeLibrary).some(e => e.document.id === input.activeThemeId)) {
        throw new BadRequestException("Такой темы нет в библиотеке");
      }
    }
    // Prisma's JSON columns want `Prisma.InputJsonValue`, not the plain typed
    // object the zod schema gives us — everything else passes through as-is.
    const { customTheme, ...fields } = input;
    const data = {
      ...fields,
      ...(customTheme !== undefined ? { customTheme: customTheme === null ? Prisma.DbNull : customTheme as Prisma.InputJsonValue } : {}),
      ...(input.customTheme === null ? { customThemeEnabled: false } : {}),
      ...(input.backgroundEffectSettings ? { backgroundEffectSettings: input.backgroundEffectSettings as Prisma.InputJsonValue } : {}),
      ...(input.sidebarFolders ? { sidebarFolders: input.sidebarFolders as Prisma.InputJsonValue } : {}),
      ...(input.sidebarOrder ? { sidebarOrder: input.sidebarOrder as Prisma.InputJsonValue } : {})
    };
    const legacyWrite = customTheme !== undefined || input.customThemeEnabled !== undefined;
    const before = legacyWrite ? await this.preferenceRow(userId) : null;
    let preference = await this.preferenceRow(userId, data);
    if (before) preference = await this.mirrorLegacyTheme(userId, before, preference);
    // Reminder delivery reads a cached copy of these preferences (the crons
    // evaluate them per row) — a save must take effect on the next tick, not
    // "some time in the next minute".
    this.notificationPolicy.invalidateAll();
    return toDto(preference);
  }

  /**
   * Create or replace one own theme. The library is a single JSON value, so the read-modify-write runs under a
   * row lock: two devices saving different themes at once both land, instead of the later write dropping the
   * earlier one. Editing the same theme on two devices is caught by `expectedUpdatedAt` (409, nothing written).
   */
  async saveTheme(userId: string, themeId: string, input: SaveThemeInput): Promise<UserPreference> {
    if (input.document.id !== themeId) throw new BadRequestException("Идентификатор темы не совпадает с адресом");
    return this.mutateLibrary(userId, (library) => {
      const index = library.findIndex(e => e.document.id === themeId);
      const existing = index >= 0 ? library[index] : null;
      if (!existing && isPresetId(themeId)) throw new BadRequestException("Этот идентификатор занят встроенной темой");
      if (input.expectedUpdatedAt !== undefined && (existing?.updatedAt ?? null) !== input.expectedUpdatedAt) {
        throw new ConflictException({
          code: "theme_revision_conflict",
          message: existing ? "Тему уже изменили на другом устройстве" : "Тема была удалена на другом устройстве",
          current: existing
        });
      }
      const entry: ThemeLibraryEntry = { document: input.document, updatedAt: nextRevision(existing?.updatedAt) };
      if (existing) return library.map((e, i) => (i === index ? entry : e));
      if (library.length >= THEME_LIBRARY_MAX) throw new BadRequestException(`В библиотеке не больше ${THEME_LIBRARY_MAX} своих тем`);
      return [...library, entry];
    });
  }

  /** Deleting the active theme moves the account to the default palette in the same write, never to a dangling id. */
  async deleteTheme(userId: string, themeId: string): Promise<UserPreference> {
    return this.mutateLibrary(userId, (library) => {
      if (!library.some(e => e.document.id === themeId)) throw new NotFoundException("Тема не найдена");
      return library.filter(e => e.document.id !== themeId);
    }, themeId);
  }

  /**
   * An older client on the network still writes the single legacy slot (customTheme/customThemeEnabled). Mirror
   * it into the library so its user sees the same palette on a current client: the document is kept as an own
   * theme (a preset id gets the "custom-" prefix, as in the migration), and enabling or disabling it moves the
   * active choice. Clearing the slot keeps the library copy — a theme is removed only by an explicit delete.
   */
  private async mirrorLegacyTheme(
    userId: string,
    before: Awaited<ReturnType<SettingsService["preferenceRow"]>>,
    preference: Awaited<ReturnType<SettingsService["preferenceRow"]>>
  ) {
    const legacy = themeDocumentSchema.safeParse(preference.customTheme);
    const previous = themeDocumentSchema.safeParse(before.customTheme);
    const libraryId = (id: string): string => (isPresetId(id) ? `custom-${id}` : id);
    if (!legacy.success) {
      // The slot was cleared: if its theme was the active one, the old client now expects the default palette.
      if (!previous.success || preference.activeThemeId !== libraryId(previous.data.id)) return preference;
      return this.prisma.userPreference.update({ where: { userId }, data: { activeThemeId: null } });
    }
    const doc = { ...legacy.data, id: libraryId(legacy.data.id) };
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ themeLibrary: Prisma.JsonValue; activeThemeId: string | null }>>`
        SELECT "themeLibrary", "activeThemeId" FROM "user_preferences" WHERE "userId" = ${userId} FOR UPDATE`;
      const library = parseLibrary(row?.themeLibrary ?? []);
      const index = library.findIndex(e => e.document.id === doc.id);
      const unchanged = index >= 0 && JSON.stringify(library[index].document) === JSON.stringify(doc);
      const entry: ThemeLibraryEntry = unchanged ? library[index] : { document: doc, updatedAt: nextRevision(library[index]?.updatedAt) };
      const next = index >= 0 ? library.map((e, i) => (i === index ? entry : e)) : library.length < THEME_LIBRARY_MAX ? [...library, entry] : library;
      const activeThemeId = preference.customThemeEnabled ? doc.id : row?.activeThemeId === doc.id ? null : row?.activeThemeId ?? null;
      return tx.userPreference.update({
        where: { userId },
        data: { themeLibrary: next as unknown as Prisma.InputJsonValue, activeThemeId }
      });
    });
  }

  private async mutateLibrary(
    userId: string,
    mutate: (library: ThemeLibraryEntry[]) => ThemeLibraryEntry[],
    deletedId?: string
  ): Promise<UserPreference> {
    await this.preferenceRow(userId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ themeLibrary: Prisma.JsonValue; activeThemeId: string | null }>>`
        SELECT "themeLibrary", "activeThemeId" FROM "user_preferences" WHERE "userId" = ${userId} FOR UPDATE`;
      const next = mutate(parseLibrary(row?.themeLibrary ?? []));
      return tx.userPreference.update({
        where: { userId },
        data: {
          themeLibrary: next as unknown as Prisma.InputJsonValue,
          ...(deletedId && row?.activeThemeId === deletedId ? { activeThemeId: null } : {})
        }
      });
    });
    return toDto(updated);
  }

  /**
   * U05 — personal sphere grouping + favorites, returned already filtered to
   * workspaces `userId` is CURRENTLY still a member of. Lazy filtering (at
   * every read) rather than eager cleanup on membership revoke: it can never
   * go stale, and there is no second code path (a cron, a membership-removal
   * hook) that has to remember to keep it in sync — see CLAUDE.md's
   * `assertProjectInWorkspace`-style "check at the point of use" pattern.
   * Membership is the source of truth; spheres/favorites never grant it.
   */
  async getOrganization(userId: string): Promise<WorkspaceOrganization> {
    const [preference, memberWorkspaceIds] = await Promise.all([
      this.preferenceRow(userId),
      this.currentWorkspaceIds(userId)
    ]);
    return filterOrganization(preference, memberWorkspaceIds);
  }

  async createSphere(userId: string, name: string): Promise<WorkspaceOrganization> {
    return this.mutateSpheres(userId, (spheres) => {
      const order = spheres.length === 0 ? 0 : Math.max(...spheres.map((s) => s.order)) + 1;
      spheres.push({ id: randomUUID(), name, order, workspaceIds: [] });
      return spheres;
    });
  }

  async updateSphere(userId: string, sphereId: string, input: { name?: string; order?: number }): Promise<WorkspaceOrganization> {
    return this.mutateSpheres(userId, (spheres) => {
      const sphere = spheres.find((s) => s.id === sphereId);
      if (!sphere) throw new NotFoundException("Сфера не найдена");
      if (input.name !== undefined) sphere.name = input.name;
      if (input.order !== undefined) sphere.order = input.order;
      return spheres;
    });
  }

  async deleteSphere(userId: string, sphereId: string): Promise<WorkspaceOrganization> {
    return this.mutateSpheres(userId, (spheres) => spheres.filter((s) => s.id !== sphereId));
  }

  /**
   * `sphereId: null` removes the workspace from whichever sphere it was in
   * (if any) without adding it to a new one — "без сферы" is a valid state,
   * not just the pre-first-sphere default. A workspace can be in at most one
   * of THIS user's spheres at a time (v1 constraint from the spec): assigning
   * it to a new sphere implicitly drops it from any other.
   */
  async assignWorkspaceSphere(userId: string, workspaceId: string, sphereId: string | null): Promise<WorkspaceOrganization> {
    await this.workspaces.assertMember(userId, workspaceId);
    return this.mutateSpheres(userId, (spheres) => {
      for (const sphere of spheres) {
        sphere.workspaceIds = sphere.workspaceIds.filter((id) => id !== workspaceId);
      }
      if (sphereId !== null) {
        const target = spheres.find((s) => s.id === sphereId);
        if (!target) throw new NotFoundException("Сфера не найдена");
        if (!target.workspaceIds.includes(workspaceId)) target.workspaceIds.push(workspaceId);
      }
      return spheres;
    });
  }

  async setWorkspaceFavorite(userId: string, workspaceId: string, favorite: boolean): Promise<WorkspaceOrganization> {
    await this.workspaces.assertMember(userId, workspaceId);
    const preference = await this.preferenceRow(userId);
    const current = new Set(preference.favoriteWorkspaceIds);
    if (favorite) current.add(workspaceId);
    else current.delete(workspaceId);
    const updated = await this.prisma.userPreference.update({
      where: { userId },
      data: { favoriteWorkspaceIds: [...current] }
    });
    const memberWorkspaceIds = await this.currentWorkspaceIds(userId);
    return filterOrganization(updated, memberWorkspaceIds);
  }

  private async currentWorkspaceIds(userId: string): Promise<Set<string>> {
    const workspaces = await this.workspaces.listForUser(userId);
    return new Set(workspaces.map((w) => w.id));
  }

  /** Read-modify-write helper shared by every sphere mutation below. */
  private async mutateSpheres(
    userId: string,
    mutate: (spheres: WorkspaceSphere[]) => WorkspaceSphere[]
  ): Promise<WorkspaceOrganization> {
    const preference = await this.preferenceRow(userId);
    const spheres = parseSpheres(preference.spheres);
    const next = mutate(spheres);
    if (next.length > 50) throw new BadRequestException("Слишком много сфер");
    const updated = await this.prisma.userPreference.update({
      where: { userId },
      data: { spheres: next as unknown as Prisma.InputJsonValue }
    });
    const memberWorkspaceIds = await this.currentWorkspaceIds(userId);
    return filterOrganization(updated, memberWorkspaceIds);
  }
}

function isPresetId(id: string): boolean {
  return (THEME_PRESET_IDS as readonly string[]).includes(id);
}

/** A damaged entry is skipped, not fatal: one broken theme must not hide the rest of the library. */
function parseLibrary(raw: Prisma.JsonValue): ThemeLibraryEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ThemeLibraryEntry[] = [];
  for (const item of raw) {
    const parsed = themeLibraryEntrySchema.safeParse(item);
    if (!parsed.success || seen.has(parsed.data.document.id)) continue;
    seen.add(parsed.data.document.id);
    out.push(parsed.data);
  }
  return out;
}

/** Strictly increasing even when two saves land in the same millisecond, so a revision check can't be fooled. */
function nextRevision(previous: string | undefined): string {
  const now = Date.now();
  const last = previous ? Date.parse(previous) : 0;
  return new Date(Math.max(now, last + 1)).toISOString();
}

/** Defensive JSON parse — an empty/malformed column reads back as "no spheres yet", never a crash. */
function parseSpheres(raw: Prisma.JsonValue): WorkspaceSphere[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    .map((entry) => ({
      id: String(entry.id ?? ""),
      name: String(entry.name ?? ""),
      order: typeof entry.order === "number" ? entry.order : 0,
      workspaceIds: Array.isArray(entry.workspaceIds) ? entry.workspaceIds.map(String) : []
    }))
    .filter((sphere) => sphere.id.length > 0);
}

function filterOrganization(
  preference: { spheres: Prisma.JsonValue; favoriteWorkspaceIds: string[] },
  memberWorkspaceIds: Set<string>
): WorkspaceOrganization {
  const spheres = parseSpheres(preference.spheres)
    .map((sphere) => ({ ...sphere, workspaceIds: sphere.workspaceIds.filter((id) => memberWorkspaceIds.has(id)) }))
    .sort((a, b) => a.order - b.order);
  const favoriteWorkspaceIds = preference.favoriteWorkspaceIds.filter((id) => memberWorkspaceIds.has(id));
  return { spheres, favoriteWorkspaceIds };
}

function toDto(preference: {
  theme: string;
  customTheme?: Prisma.JsonValue;
  customThemeEnabled?: boolean;
  themeLibrary?: Prisma.JsonValue;
  activeThemeId?: string | null;
  workspaceThemeMode?: string;
  accent: string;
  density: string;
  backgroundStyle: string;
  backgroundIntensity: string;
  backgroundEffectSettings: Prisma.JsonValue;
  targetCursorEnabled: boolean;
  surfaceStyle: string;
  panelOpacity: number;
  panelBlur: number;
  panelAccent: string | null;
  timeZone: string | null;
  weekStartsOn: number;
  desktopNotifications: boolean;
  taskReminders: boolean;
  eventReminders: boolean;
  financeAlerts: boolean;
  inventoryAlerts: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  dashboardWidgets: string[];
  hiddenModules: string[];
  showNoteIds: boolean;
  sidebarFolders: Prisma.JsonValue;
  sidebarOrder: Prisma.JsonValue;
  sidebarPosition: string;
  openTabsMode: string;
  motionLevel: string;
  onboardingCompletedAt: Date | null;
}): UserPreference {
  const parsedTheme = themeDocumentSchema.safeParse(preference.customTheme);
  return {
    ...preference,
    customTheme: parsedTheme.success ? parsedTheme.data : null,
    customThemeEnabled: parsedTheme.success && preference.customThemeEnabled === true,
    themeLibrary: parseLibrary(preference.themeLibrary ?? []),
    activeThemeId: preference.activeThemeId ?? null,
    workspaceThemeMode: workspaceThemeModeSchema.safeParse(preference.workspaceThemeMode).success ? (preference.workspaceThemeMode as UserPreference["workspaceThemeMode"]) : "follow",
    backgroundEffectSettings: mergeBackgroundEffectSettings(preference.backgroundEffectSettings),
    // A damaged value must not break the settings screen: read it defensively, fall back to no folders.
    sidebarFolders: sidebarFoldersSchema.safeParse(preference.sidebarFolders).success ? (preference.sidebarFolders as UserPreference["sidebarFolders"]) : [],
    sidebarOrder: sidebarOrderSchema.safeParse(preference.sidebarOrder).success ? (preference.sidebarOrder as string[]) : [],
    sidebarPosition: sidebarPositionSchema.safeParse(preference.sidebarPosition).success ? (preference.sidebarPosition as UserPreference["sidebarPosition"]) : "left",
    openTabsMode: openTabsModeSchema.safeParse(preference.openTabsMode).success ? (preference.openTabsMode as UserPreference["openTabsMode"]) : "accumulate",
    motionLevel: motionLevelSchema.safeParse(preference.motionLevel).success ? (preference.motionLevel as UserPreference["motionLevel"]) : "calm",
    onboardingCompletedAt: preference.onboardingCompletedAt?.toISOString() ?? null
  } as UserPreference;
}

/**
 * The DB default is `{}` (new rows, and every row created before this field
 * existed) — fill in any variant missing from the stored JSON with its
 * defaults rather than making every reader (here and the web client) handle
 * a partially-populated shape.
 */
function mergeBackgroundEffectSettings(stored: Prisma.JsonValue): BackgroundEffectSettings {
  const storedObj = (stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {}) as Partial<BackgroundEffectSettings>;
  return {
    "liquid-ether": { ...DEFAULT_BACKGROUND_EFFECT_SETTINGS["liquid-ether"], ...storedObj["liquid-ether"] },
    "light-pillar": { ...DEFAULT_BACKGROUND_EFFECT_SETTINGS["light-pillar"], ...storedObj["light-pillar"] },
    "dark-veil": { ...DEFAULT_BACKGROUND_EFFECT_SETTINGS["dark-veil"], ...storedObj["dark-veil"] },
    "shape-waves": { ...DEFAULT_BACKGROUND_EFFECT_SETTINGS["shape-waves"], ...storedObj["shape-waves"] }
  };
}
