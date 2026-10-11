import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Notification } from "@orion/shared-types";
import type { OrionModuleId } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ModulesService } from "../modules/modules.service";

/**
 * R18-03: maps a notification's `entityType` to the module its source
 * entity lives in, so `list`/`createTx`/`markRead` can apply the SAME
 * actor-aware access check the entity's own endpoint would (via
 * `ModulesService.accessibleSetTx` — disabled-for-everyone or
 * restricted-for-`member` both close it). `null` means "not gated by a
 * module" — either a system notification (`entityType` itself is `null`)
 * or an `entityType` this table doesn't recognize; both are treated as
 * always-visible rather than hidden, per the review's explicit carve-out
 * for system notifications not tied to a restricted entity.
 */
function moduleIdForEntityType(entityType: string | null): OrionModuleId | null {
  switch (entityType) {
    case "task":
      return "tasks";
    case "event":
      return "calendar";
    case "budget":
    case "transaction":
      return "finance";
    case "inventory_item":
      return "inventory";
    case "note":
      return "notes";
    case "document":
      return "documents";
    case "project":
      return "projects";
    case "habit":
      return "habits";
    case "list":
    case "list_item":
      return "lists";
    default:
      return null;
  }
}

export interface CreateNotificationData {
  workspaceId: string;
  /** User id this notification is addressed to. Required — see the class comment. */
  recipientId: string;
  kind: Notification["kind"];
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  /**
   * Dedup key, unique together with `recipientId` (partial unique index —
   * see the `addressed_notifications` migration). Producers that run on a
   * cron tick (DueTaskCheckerService, EventReminderService) should always
   * pass one: calling `createTx` again for the same (recipient, eventKey)
   * on a repeated run is then a safe no-op instead of a duplicate row.
   */
  eventKey?: string;
  /**
   * The user who *caused* this notification, if any (e.g. whoever completed
   * a task). When it equals `recipientId`, `createTx` skips silently — your
   * own action never notifies you about yourself. Cron producers that check
   * time-based state (overdue tasks, due events) have no "actor" and omit
   * this; it exists for future actor-triggered producers.
   */
  actorId?: string;
}

/**
 * Owns every read/write of the `notifications` table. Since v0.28 every
 * notification is addressed to exactly one recipient (`recipientId`) —
 * `readAt` is a column on that one row, so read state is per-recipient by
 * construction: A marking their copy read never touches B's row for the
 * same event, because there is no shared row anymore (see S07 in
 * docs/HISTORY.md).
 *
 * Rows created before this rework have `recipientId: null` — a deliberate
 * legacy archive (see `list()`), not a bug to backfill: nothing in the old
 * schema recorded who a workspace-wide notification was "for", so there is
 * no correct owner to assign retroactively.
 */
@Injectable()
export class NotificationCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService
  ) {}

  /**
   * R18-03: `membership`+`recipientId` used to be the whole check — correct
   * for "is this your inbox", but it never re-verified that the recipient
   * still has *module* access to whatever the notification is actually
   * about. A member who got a task-due notification before `tasks` was
   * restricted kept reading its title/body via this list forever after,
   * even though the task's own endpoint now 403s them (Codex
   * 18-REVIEW-FINAL-PASS, R18-03). Filtered here, in the DTO path — not by
   * hiding a button client-side — because the leak is the title/body
   * fields themselves.
   */
  async list(userId: string, workspaceId: string, unreadOnly = false): Promise<Notification[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const accessible = await this.modules.accessibleSetTx(tx, userId, workspaceId);
      const found = await tx.notification.findMany({
        // recipientId: userId — NOT just workspaceId — is what makes this
        // addressed: a fellow member's notifications never show up here,
        // and legacy rows (recipientId null) are excluded, not shown to
        // everyone as before.
        where: { workspaceId, recipientId: userId, ...(unreadOnly ? { readAt: null } : {}) },
        orderBy: { createdAt: "desc" },
        // Over-fetch before the module-access filter below, then slice to
        // the real page size — there's no cursor pagination here yet to
        // filter-then-continue-fetching against, so this keeps the common
        // case (nothing restricted) exact and the restricted case at least
        // not silently short of a full page.
        take: 300
      });
      return found.filter((n) => this.isVisibleToActor(n.entityType, accessible)).slice(0, 100);
    });
    return rows.map(toDto);
  }

  /** Same module-access gate as `list()` — see its doc comment. */
  private isVisibleToActor(entityType: string | null, accessible: Set<OrionModuleId>): boolean {
    const moduleId = moduleIdForEntityType(entityType);
    return !moduleId || accessible.has(moduleId);
  }

  async markRead(userId: string, workspaceId: string, notificationId: string, read: boolean): Promise<Notification> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const notification = await tx.notification.findUnique({ where: { id: notificationId } });
      // recipientId must match the caller: without this check, any workspace
      // member could mark (or query) another member's notification read —
      // exactly the shared-read-state bug S07 fixes.
      if (!notification || notification.workspaceId !== workspaceId || notification.recipientId !== userId) {
        throw new NotFoundException("Уведомление не найдено");
      }
      // R18-03: a notification whose source module is currently inaccessible
      // to this actor is not "not found" (it's still theirs), but marking it
      // read/unread is a state change on content they should be treated as
      // not seeing — refuse the same way `list()` hides it, not a leak, just
      // consistent with "can't act on what you can't see".
      const accessible = await this.modules.accessibleSetTx(tx, userId, workspaceId);
      if (!this.isVisibleToActor(notification.entityType, accessible)) {
        throw new NotFoundException("Уведомление не найдено");
      }
      return tx.notification.update({ where: { id: notificationId }, data: { readAt: read ? new Date() : null } });
    });
    return toDto(row);
  }

  async markAllRead(userId: string, workspaceId: string): Promise<{ updated: number }> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const accessible = await this.modules.accessibleSetTx(tx, userId, workspaceId);
      // R18-03: "mark all read" must not silently sweep in notifications
      // whose source module the actor can no longer see the content of —
      // same `isVisibleToActor` gate as `list()`, applied to the id set here
      // since `updateMany`'s WHERE can't run the module-access rule itself.
      const candidates = await tx.notification.findMany({
        where: { workspaceId, recipientId: userId, readAt: null },
        select: { id: true, entityType: true }
      });
      const ids = candidates.filter((n) => this.isVisibleToActor(n.entityType, accessible)).map((n) => n.id);
      if (ids.length === 0) return { updated: 0 };
      const result = await tx.notification.updateMany({
        where: { id: { in: ids } },
        data: { readAt: new Date() }
      });
      return { updated: result.count };
    });
  }

  async remove(userId: string, workspaceId: string, notificationId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const result = await tx.notification.deleteMany({ where: { id: notificationId, workspaceId, recipientId: userId } });
      if (result.count === 0) throw new NotFoundException("Уведомление не найдено");
    });
  }

  /**
   * Creates one addressed notification, or silently does nothing when:
   *  - the recipient is no longer a member of the workspace (revoked access
   *    — a producer must not resurrect a delivery for someone who was
   *    removed after the underlying event was queued but before this ran);
   *  - `actorId === recipientId` (self-action never notifies you about
   *    your own doing);
   *  - the same `(recipientId, eventKey)` pair already has a row (repeated
   *    cron tick — P2002 on the partial unique index, treated as success);
   *  - (R18-03) `entityType` maps to a module the recipient can't currently
   *    access (disabled for everyone, or restricted and the recipient is a
   *    plain `member`) — same rule `list()` reads back with, applied at
   *    creation time too so a notification about something the recipient is
   *    already locked out of never gets stored addressed to them in the
   *    first place.
   *
   * Returns `null` in all four cases; callers that only count deliveries
   * (the crons) should treat `null` the same as "skipped".
   */
  async createTx(tx: Prisma.TransactionClient, data: CreateNotificationData): Promise<Notification | null> {
    if (data.actorId && data.actorId === data.recipientId) return null;

    const member = await tx.workspaceMember.findFirst({
      where: { workspaceId: data.workspaceId, userId: data.recipientId },
      select: { id: true }
    });
    if (!member) return null;

    const moduleId = moduleIdForEntityType(data.entityType ?? null);
    if (moduleId) {
      const accessible = await this.modules.accessibleSetTx(tx, data.recipientId, data.workspaceId);
      if (!accessible.has(moduleId)) return null;
    }

    const row = {
      workspaceId: data.workspaceId,
      recipientId: data.recipientId,
      kind: data.kind,
      title: data.title,
      body: data.body ?? "",
      entityType: data.entityType,
      entityId: data.entityId,
      eventKey: data.eventKey ?? null
    };

    if (!data.eventKey) {
      return toDto(await tx.notification.create({ data: row }));
    }

    // `createMany` + `skipDuplicates` instead of `create` + catch(P2002): a
    // unique-constraint violation aborts the whole enclosing Postgres
    // transaction (25P02 on the next statement, e.g. the caller's
    // `task.update` right after this call) unless caught inside a savepoint
    // — `skipDuplicates` never throws, so callers can keep using their own
    // outer transaction for the rest of the tick.
    const result = await tx.notification.createMany({ data: [row], skipDuplicates: true });
    if (result.count === 0) return null; // a prior run already has this (recipientId, eventKey)
    const created = await tx.notification.findFirst({
      where: { recipientId: data.recipientId, eventKey: data.eventKey },
      orderBy: { createdAt: "desc" }
    });
    return created ? toDto(created) : null;
  }
}

function toDto(row: {
  id: string; workspaceId: string; recipientId: string | null; kind: string; title: string; body: string;
  entityType: string | null; entityId: string | null; readAt: Date | null; createdAt: Date;
}): Notification {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    recipientId: row.recipientId,
    kind: row.kind as Notification["kind"],
    title: row.title,
    body: row.body,
    entityType: row.entityType,
    entityId: row.entityId,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString()
  };
}
