import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { isWithinQuietHours } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";

/**
 * Which preference toggle governs which kind of reminder. `"entity"` (U03,
 * personal one-shot `EntityReminder`) deliberately has no dedicated
 * `UserPreference` toggle yet — the user who created it explicitly asked for
 * that exact delivery, closer to a manual "напомнить сейчас" than an
 * ambient cron — so it only respects quiet hours below, not a togglable
 * on/off. A dedicated toggle can be added later without touching callers.
 * `"contact"` (birthdays, «пора связаться») is in the same position: quiet
 * hours apply, there is no separate toggle yet.
 */
export type ReminderKind = "task" | "event" | "finance" | "inventory" | "entity" | "contact";

/** Runs a system-role read: in its own `asSystem` transaction, or inside the caller's open one (see `allowsForUserTx`). */
type SystemRead = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

interface RecipientPreferences {
  taskReminders: boolean;
  eventReminders: boolean;
  financeAlerts: boolean;
  inventoryAlerts: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timeZone: string | null;
}

/**
 * Single place that answers "should this reminder be delivered right now?".
 *
 * Why it exists: `UserPreference` had `taskReminders`, `eventReminders`,
 * `financeAlerts`, `quietHoursStart/End` and `timeZone` since v0.14, and
 * **nothing read them** — the crons sent to Telegram and the notification
 * centre regardless, so the settings screen was quietly lying. Every producer
 * (overdue-task cron, event-reminder cron, budget alerts) now asks here first.
 *
 * Whose preferences? Since v0.28 (S07, addressed notifications) this is
 * genuinely per-recipient: `allowsForUser(userId, kind)` reads that exact
 * user's `UserPreference` row — quiet hours and toggles are the *recipient's*,
 * never the actor's and never a workspace-wide stand-in. `allows(workspaceId,
 * kind)` remains as a convenience for producers that don't (yet) address
 * anyone but the workspace owner (finance/inventory alerts, event reminders —
 * they have no per-item assignee the way `Task.assigneeId` does), and is
 * implemented in terms of `resolveOwnerId` + `allowsForUser`.
 *
 * Caching: the crons evaluate this per row (every overdue task, every event
 * with a reminder), so results are cached for a minute — the same cadence as
 * the two crons that use them, so a settings change takes effect within a tick.
 */
@Injectable()
export class NotificationPolicyService {
  private readonly logger = new Logger(NotificationPolicyService.name);
  private static readonly CACHE_TTL_MS = 60_000;
  private readonly prefsCache = new Map<string, { prefs: RecipientPreferences | null; at: number }>();
  private readonly ownerCache = new Map<string, { userId: string | null; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /** Convenience for producers with no per-item recipient: resolves the workspace owner, then checks their prefs. */
  async allows(workspaceId: string, kind: ReminderKind, now = new Date()): Promise<boolean> {
    const ownerId = await this.resolveOwnerId(workspaceId);
    if (!ownerId) return true; // no members at all — nothing to suppress against.
    return this.allowsForUser(ownerId, kind, now);
  }

  /** The real per-recipient check — reads exactly this user's UserPreference row. */
  async allowsForUser(userId: string, kind: ReminderKind, now = new Date()): Promise<boolean> {
    return this.decide(await this.preferencesForUser(userId, this.ownTransaction), kind, now);
  }

  /**
   * `allowsForUser` / `resolveOwnerId` for a producer that is already inside a
   * transaction (low-stock alerts fire mid-purchase). Reading through the
   * caller's `tx` instead of opening a second one matters under load: each
   * concurrent request already holds a pooled connection, and with a small
   * pool (3 on a 1-CPU CI runner) every one of them waited for a second
   * connection that never freed up — "Unable to start a transaction in the
   * given time", a 500 on a valid purchase.
   */
  async allowsForUserTx(tx: Prisma.TransactionClient, userId: string, kind: ReminderKind, now = new Date()): Promise<boolean> {
    return this.decide(await this.preferencesForUser(userId, this.within(tx)), kind, now);
  }

  async resolveOwnerIdTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<string | null> {
    return this.ownerFor(workspaceId, this.within(tx));
  }

  private decide(prefs: RecipientPreferences | null, kind: ReminderKind, now: Date): boolean {
    if (!prefs) return true;

    if (kind === "task" && !prefs.taskReminders) return false;
    if (kind === "event" && !prefs.eventReminders) return false;
    if (kind === "finance" && !prefs.financeAlerts) return false;
    if (kind === "inventory" && !prefs.inventoryAlerts) return false;

    return !isWithinQuietHours(prefs.quietHoursStart, prefs.quietHoursEnd, now, prefs.timeZone);
  }

  /**
   * Owner (or, absent one, any member) userId for a workspace — used both by
   * `allows()` and by producers that need *a* recipient when there is no more
   * specific one (e.g. DueTaskCheckerService falls back to this when a task
   * has no assignee).
   */
  async resolveOwnerId(workspaceId: string): Promise<string | null> {
    return this.ownerFor(workspaceId, this.ownTransaction);
  }

  private readonly ownTransaction: SystemRead = (fn) => this.prisma.asSystem(fn);

  /**
   * The same orion_system switch `asSystem` makes, but scoped to a few reads
   * inside the caller's transaction; `RESET ROLE` returns to the login role
   * (orion_app), and `app.current_user_id` set by `withUser` is untouched.
   */
  private within(tx: Prisma.TransactionClient): SystemRead {
    return async (fn) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE orion_system");
      // No `finally`: if `fn` fails the whole transaction is aborted and rolls the role back
      // itself, and a RESET there would only replace the real error with "transaction is aborted".
      const result = await fn(tx);
      await tx.$executeRawUnsafe("RESET ROLE");
      return result;
    };
  }

  private async ownerFor(workspaceId: string, read: SystemRead): Promise<string | null> {
    const cached = this.ownerCache.get(workspaceId);
    if (cached && Date.now() - cached.at < NotificationPolicyService.CACHE_TTL_MS) {
      return cached.userId;
    }
    const userId = await read(async (tx) => {
      const membership =
        (await tx.workspaceMember.findFirst({ where: { workspaceId, role: "owner" } })) ??
        (await tx.workspaceMember.findFirst({ where: { workspaceId } }));
      if (!membership) {
        this.logger.warn(`Workspace ${workspaceId} has no members; delivering reminders by default`);
        return null;
      }
      return membership.userId;
    });
    this.ownerCache.set(workspaceId, { userId, at: Date.now() });
    return userId;
  }

  /**
   * Drops the cache so the next reminder decision sees fresh preferences.
   * Called by SettingsService right after a save: without it, a user who
   * disables task reminders would still get up to a minute of them, which
   * looks exactly like the bug this service was written to fix.
   */
  invalidateAll(): void {
    this.prefsCache.clear();
    this.ownerCache.clear();
  }

  /** One user's preferences, cached for a minute (see the class comment). */
  private async preferencesForUser(userId: string, read: SystemRead): Promise<RecipientPreferences | null> {
    const cached = this.prefsCache.get(userId);
    if (cached && Date.now() - cached.at < NotificationPolicyService.CACHE_TTL_MS) {
      return cached.prefs;
    }

    const prefs = await read(async (tx) => {
      // `asSystem`, not `withUser`: the crons run without a "current user".
      const row = await tx.userPreference.findUnique({ where: { userId } });
      if (!row) return null; // Preferences are created lazily on first save — absent row means "defaults".
      return {
        taskReminders: row.taskReminders,
        eventReminders: row.eventReminders,
        financeAlerts: row.financeAlerts,
        inventoryAlerts: row.inventoryAlerts,
        quietHoursStart: row.quietHoursStart,
        quietHoursEnd: row.quietHoursEnd,
        timeZone: row.timeZone
      };
    });

    this.prefsCache.set(userId, { prefs, at: Date.now() });
    return prefs;
  }
}
