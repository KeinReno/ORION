import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  CreateEntityReminderInput,
  EntityReminder,
  EntityReminderStatus,
  OrionModuleId,
  SearchableEntityType
} from "@orion/shared-types";
import { SEARCH_TYPE_MODULE } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ENTITY_REGISTRY } from "./entity-registry";

/**
 * U03 (24-CONNECTED-CORE-BACKLOG.md): personal one-shot reminder against any
 * entity from the closed U01 registry. Delivery is a separate cron
 * (`ReminderCheckerService`) — this service only owns create/list/cancel.
 *
 * First slice: `recipientId` is always the creator (`ownerId`). "Отзыв
 * доступа учитывается" is enforced at TWO points, not one:
 *  - here, at creation time (`canRead` via `accessibleSetTx` + entity
 *    ownership check — you can't reminder yourself about something you
 *    can't currently see);
 *  - again in `ReminderCheckerService` at delivery time, because access can
 *    be revoked (module restricted, workspace membership removed) any time
 *    between creation and the scheduled instant.
 */
@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService
  ) {}

  async list(userId: string, workspaceId: string): Promise<EntityReminder[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const accessible = await this.modules.accessibleSetTx(tx, userId, workspaceId);
      const rows = await tx.entityReminder.findMany({
        where: { workspaceId, ownerId: userId },
        orderBy: { scheduledAt: "asc" }
      });
      const out: EntityReminder[] = [];
      for (const row of rows) {
        const title = await this.summaryIfAccessible(tx, workspaceId, row.entityType as SearchableEntityType, row.entityId, accessible);
        out.push(toDto(row, title));
      }
      return out;
    });
  }

  /**
   * R28-02: `create`/the delivery cron already gate on `accessibleSetTx`
   * before reading a title, but `list`/`cancel` used to call
   * `ENTITY_REGISTRY[...].summary` unconditionally — so revoking a member's
   * `notes` access after they created a reminder against a note left the
   * note's title (`entityTitle`) visible forever after in their reminder
   * list, even though the note's own endpoint now 403s them. Same shape as
   * the `notification-center.service.ts` R18-03 fix: a currently-inaccessible
   * module never reaches the summary lookup, the reminder itself just comes
   * back with a neutral `entityTitle: null` ("недоступно") instead of being
   * silently dropped — it is still the caller's own reminder to see/cancel,
   * just without leaking the restricted entity's content.
   */
  private async summaryIfAccessible(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    entityType: SearchableEntityType,
    entityId: string,
    accessible: Set<OrionModuleId>
  ): Promise<string | null> {
    if (!accessible.has(SEARCH_TYPE_MODULE[entityType])) return null;
    return ENTITY_REGISTRY[entityType].summary(tx, workspaceId, entityId);
  }

  async create(userId: string, workspaceId: string, input: CreateEntityReminderInput): Promise<EntityReminder> {
    const scheduledAt = new Date(input.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      throw new BadRequestException("Некорректная дата напоминания");
    }

    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const accessible = await this.modules.accessibleSetTx(tx, userId, workspaceId);
      if (!accessible.has(SEARCH_TYPE_MODULE[input.entityType])) {
        throw new ForbiddenException("Модуль недоступен");
      }
      const title = await ENTITY_REGISTRY[input.entityType].summary(tx, workspaceId, input.entityId);
      if (title === null) {
        throw new NotFoundException("Связываемый объект не найден");
      }

      const row = await tx.entityReminder.create({
        data: {
          workspaceId,
          ownerId: userId,
          recipientId: userId,
          entityType: input.entityType,
          entityId: input.entityId,
          scheduledAt,
          timezone: input.timezone,
          status: "pending"
        }
      });
      return toDto(row, title);
    });
  }

  /** Cancel — owner only. Idempotent: cancelling an already-cancelled/delivered reminder is a no-op 404 only if it never belonged to this user. */
  async cancel(userId: string, workspaceId: string, reminderId: string): Promise<EntityReminder> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const existing = await tx.entityReminder.findUnique({ where: { id: reminderId } });
      if (!existing || existing.workspaceId !== workspaceId || existing.ownerId !== userId) {
        throw new NotFoundException("Напоминание не найдено");
      }
      const status: EntityReminderStatus = existing.status === "pending" ? "cancelled" : (existing.status as EntityReminderStatus);
      const row =
        existing.status === "pending"
          ? await tx.entityReminder.update({ where: { id: reminderId }, data: { status } })
          : existing;
      // R28-02: same neutral-title gate as `list()` — cancelling your own
      // reminder must still work even after access was revoked (it's your
      // record to manage), but the response must not resurrect the
      // restricted entity's title.
      const accessible = await this.modules.accessibleSetTx(tx, userId, workspaceId);
      const title = await this.summaryIfAccessible(tx, workspaceId, row.entityType as SearchableEntityType, row.entityId, accessible);
      return toDto(row, title);
    });
  }
}

function toDto(
  row: {
    id: string;
    workspaceId: string;
    ownerId: string;
    recipientId: string;
    entityType: string;
    entityId: string;
    scheduledAt: Date;
    timezone: string;
    status: string;
    deliveredAt: Date | null;
    createdAt: Date;
  },
  entityTitle: string | null
): EntityReminder {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    ownerId: row.ownerId,
    recipientId: row.recipientId,
    entityType: row.entityType as SearchableEntityType,
    entityId: row.entityId,
    entityTitle,
    scheduledAt: row.scheduledAt.toISOString(),
    timezone: row.timezone,
    status: row.status as EntityReminderStatus,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString()
  };
}
