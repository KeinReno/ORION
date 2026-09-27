import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  DEFAULT_BACKGROUND_EFFECT_SETTINGS,
  type BackgroundEffectSettings,
  type UpdateUserPreferenceInput,
  type UserPreference,
  type WorkspaceOrganization,
  type WorkspaceSphere
} from "@orion/shared-types";
import type { Prisma } from "@prisma/client";
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

  async get(userId: string): Promise<UserPreference> {
    const preference = await this.prisma.userPreference.upsert({
      where: { userId },
      create: { userId },
      update: {}
    });
    return toDto(preference);
  }

  async update(userId: string, input: UpdateUserPreferenceInput): Promise<UserPreference> {
    // Prisma's JSON columns want `Prisma.InputJsonValue`, not the plain typed
    // object the zod schema gives us — everything else passes through as-is.
    const data = {
      ...input,
      ...(input.backgroundEffectSettings ? { backgroundEffectSettings: input.backgroundEffectSettings as Prisma.InputJsonValue } : {})
    };
    const preference = await this.prisma.userPreference.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data
    });
    // Reminder delivery reads a cached copy of these preferences (the crons
    // evaluate them per row) — a save must take effect on the next tick, not
    // "some time in the next minute".
    this.notificationPolicy.invalidateAll();
    return toDto(preference);
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
      this.prisma.userPreference.upsert({ where: { userId }, create: { userId }, update: {} }),
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
    const preference = await this.prisma.userPreference.upsert({ where: { userId }, create: { userId }, update: {} });
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
    const preference = await this.prisma.userPreference.upsert({ where: { userId }, create: { userId }, update: {} });
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
  onboardingCompletedAt: Date | null;
}): UserPreference {
  return {
    ...preference,
    backgroundEffectSettings: mergeBackgroundEffectSettings(preference.backgroundEffectSettings),
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
