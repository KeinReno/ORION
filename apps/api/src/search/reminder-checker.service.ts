import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { SearchableEntityType } from "@orion/shared-types";
import { SEARCH_TYPE_MODULE } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { NotificationCenterService } from "../notifications/notification-center.service";
import { NotificationPolicyService } from "../notifications/notification-policy.service";
import { ModulesService } from "../modules/modules.service";
import { ENTITY_REGISTRY } from "./entity-registry";

/**
 * U03: delivers `EntityReminder` rows whose `scheduledAt` has passed. This is
 * a NEW, independent cron — it does not touch `DueTaskCheckerService` or
 * `EventReminderService` (23-UNIVERSAL-CONNECTED-CORE.md: "существующие
 * recurring/event reminders не переписывать без миграционного плана").
 *
 * "Reminder повторно не доставляется": delivery is `eventKey`-deduped via
 * `NotificationCenterService.createTx` (`entity_reminder:<id>`, the same
 * `createMany({ skipDuplicates: true })` pattern every other cron here uses —
 * two overlapping ticks racing on the same row insert at most one
 * notification), AND `status` only flips to `delivered` after that insert
 * succeeds (or is confirmed a no-op dedup) — never before, so a crashed tick
 * leaves the row `pending` to retry next minute rather than silently lost.
 *
 * "Отзыв доступа учитывается": at delivery time (not just at creation time)
 * this re-checks that the recipient is still a workspace member AND that the
 * entity's module is still accessible to them AND that the target entity
 * still resolves (not deleted/moved out of the workspace). Any of those
 * failing marks the row `cancelled` (not `delivered` — nothing was actually
 * shown) so it doesn't retry forever.
 */
@Injectable()
export class ReminderCheckerService {
  private readonly logger = new Logger(ReminderCheckerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationCenterService,
    private readonly policy: NotificationPolicyService,
    private readonly modules: ModulesService
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    await this.runCheck();
  }

  async runCheck(): Promise<{ delivered: number; skipped: number; cancelled: number }> {
    const due = await this.prisma.asSystem((tx) =>
      tx.entityReminder.findMany({ where: { status: "pending", scheduledAt: { lte: new Date() } } })
    );

    let delivered = 0;
    let skipped = 0;
    let cancelled = 0;

    for (const reminder of due) {
      await this.prisma.asSystem(async (tx) => {
        // Access-revocation re-check — see class doc comment.
        const member = await tx.workspaceMember.findFirst({
          where: { workspaceId: reminder.workspaceId, userId: reminder.recipientId },
          select: { id: true }
        });
        if (!member) {
          await tx.entityReminder.update({ where: { id: reminder.id }, data: { status: "cancelled" } });
          cancelled += 1;
          return;
        }

        const accessible = await this.modules.accessibleSetTx(tx, reminder.recipientId, reminder.workspaceId);
        const entityType = reminder.entityType as SearchableEntityType;
        if (!accessible.has(SEARCH_TYPE_MODULE[entityType])) {
          await tx.entityReminder.update({ where: { id: reminder.id }, data: { status: "cancelled" } });
          cancelled += 1;
          return;
        }

        const title = await ENTITY_REGISTRY[entityType].summary(tx, reminder.workspaceId, reminder.entityId);
        if (title === null) {
          // Entity deleted, or moved out of this workspace — nothing left to remind about.
          await tx.entityReminder.update({ where: { id: reminder.id }, data: { status: "cancelled" } });
          cancelled += 1;
          return;
        }

        if (!(await this.policy.allowsForUser(reminder.recipientId, "entity"))) {
          // Quiet hours right now — leave `pending` (not cancelled, not delivered)
          // so the next tick after quiet hours end retries it, same principle
          // as DueTaskCheckerService's policy-suppressed branch.
          skipped += 1;
          return;
        }

        const created = await this.notifications.createTx(tx, {
          workspaceId: reminder.workspaceId,
          recipientId: reminder.recipientId,
          kind: "entity_reminder",
          eventKey: `entity_reminder:${reminder.id}`,
          title: `Напоминание: ${title}`,
          body: "Вы попросили напомнить об этом.",
          entityType: reminder.entityType,
          entityId: reminder.entityId
        });

        // `created === null` here means only the eventKey-dedup path (a
        // repeated tick for a row this same handler already marked
        // delivered — which can't happen since status is already flipped —
        // or a rare double-run before the status write below lands): either
        // way the notification exists or will on the next createTx call, so
        // it's still correct to mark delivered.
        await tx.entityReminder.update({
          where: { id: reminder.id },
          data: { status: "delivered", deliveredAt: new Date() }
        });
        delivered += 1;
        if (!created) {
          this.logger.debug(`Reminder ${reminder.id} notification already existed (dedup) — marked delivered anyway`);
        }
      });
    }

    if (delivered > 0) this.logger.log(`Delivered ${delivered} entity reminder(s)`);
    if (cancelled > 0) this.logger.log(`Cancelled ${cancelled} entity reminder(s): доступ отозван или объект удалён`);
    return { delivered, skipped, cancelled };
  }
}
