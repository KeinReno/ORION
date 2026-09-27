import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { Prisma } from "@prisma/client";
import { TASK_CLOSED_STATUSES } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { TelegramService } from "./telegram.service";
import { NotificationCenterService } from "./notification-center.service";
import { NotificationPolicyService } from "./notification-policy.service";

type OverdueTask = Prisma.TaskGetPayload<{ include: { workspace: true } }>;

const OVERDUE_WHERE = {
  dueAt: { lte: new Date() },
  notifiedAt: null,
  // Canceled tasks are closed too — before v0.14 the enum had no such status,
  // so `not: "done"` was the same thing as "still open".
  status: { notIn: [...TASK_CLOSED_STATUSES] }
};

@Injectable()
export class DueTaskCheckerService {
  private readonly logger = new Logger(DueTaskCheckerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly notifications: NotificationCenterService,
    private readonly policy: NotificationPolicyService
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    await this.runCheck();
  }

  /**
   * System-wide check across every workspace — only ever invoked by the
   * cron above, never directly reachable by a user request. See
   * runCheckForUser() for the per-user variant used by the manual trigger.
   */
  async runCheck(): Promise<{ notified: number; skipped: number }> {
    const overdue = await this.prisma.asSystem((tx) =>
      tx.task.findMany({
        where: { ...OVERDUE_WHERE, workspace: { NOT: { disabledModules: { has: "tasks" } } } },
        include: { workspace: true }
      })
    );
    return this.notifyAndMark(overdue, (fn) => this.prisma.asSystem(fn), true);
  }

  /**
   * Scoped to one user's own workspaces — this is what POST /notifications/check-due
   * uses, so a user can only ever trigger reminders for their own data.
   *
   * Deliberately ignores the notification preferences (`respectPolicy: false`):
   * the user explicitly asked for this run right now, so quiet hours and the
   * per-kind toggles must not turn the button into a no-op.
   */
  async runCheckForUser(userId: string): Promise<{ notified: number; skipped: number }> {
    const overdue = await this.prisma.withUser(userId, (tx) =>
      tx.task.findMany({
        where: { ...OVERDUE_WHERE, workspace: { NOT: { disabledModules: { has: "tasks" } } } },
        include: { workspace: true }
      })
    );
    return this.notifyAndMark(overdue, (fn) => this.prisma.withUser(userId, fn), false);
  }

  /**
   * Who gets notified about this overdue task: the assignee ("Команда"
   * plugin, `Task.assigneeId` → `WorkspaceMember`) when set, else the
   * workspace owner — same fallback `NotificationPolicyService.allows()`
   * used before recipients existed. Returns null only when the workspace
   * genuinely has no members (nothing to notify).
   */
  private async resolveRecipient(task: OverdueTask): Promise<string | null> {
    if (task.assigneeId) {
      const assignee = await this.prisma.asSystem((tx) =>
        tx.workspaceMember.findUnique({ where: { id: task.assigneeId! }, select: { userId: true } })
      );
      // Assignee row can be missing if it was removed from the workspace
      // (revoked) without clearing Task.assigneeId — fall through to owner
      // rather than notifying a dangling reference.
      if (assignee) return assignee.userId;
    }
    return this.policy.resolveOwnerId(task.workspaceId);
  }

  private async notifyAndMark(
    tasks: OverdueTask[],
    scoped: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>,
    respectPolicy: boolean
  ): Promise<{ notified: number; skipped: number }> {
    let notified = 0;
    let skipped = 0;
    for (const task of tasks) {
      const recipientId = await this.resolveRecipient(task);
      if (!recipientId) {
        skipped += 1;
        continue;
      }
      if (respectPolicy && !(await this.policy.allowsForUser(recipientId, "task"))) {
        // Suppressed by the recipient's own preferences (their toggle is
        // off, or it's their quiet hours — not the actor's, not the
        // workspace owner's unless they are the recipient). `notifiedAt` is
        // deliberately left null: the reminder isn't lost, it fires on the
        // first tick after preferences allow it.
        skipped += 1;
        continue;
      }
      const label = task.projectTag ? `[${task.projectTag}] ` : "";
      const delivered = await this.telegram.sendMessage(
        `⏰ Просрочена задача: ${label}${task.title} (пространство: ${task.workspace.name})`
      );
      await scoped(async (tx) => {
        await this.notifications.createTx(tx, {
          workspaceId: task.workspaceId,
          recipientId,
          kind: "task_due",
          // Unique per (recipient, task) — a repeated cron run for the same
          // still-not-marked task is a P2002 no-op, not a duplicate row.
          eventKey: `task_due:${task.id}`,
          title: `Просрочена задача: ${task.title}`,
          body: task.projectTag ? `Проект: ${task.projectTag}` : "Откройте задачу и обновите срок или статус.",
          entityType: "task",
          entityId: task.id
        });
        await tx.task.update({ where: { id: task.id }, data: { notifiedAt: new Date() } });
      });
      notified++;
      if (!delivered) this.logger.warn(`Telegram delivery failed for task ${task.id}; in-app notification created`);
    }
    if (notified > 0) {
      this.logger.log(`Notified about ${notified} overdue task(s)`);
    }
    if (skipped > 0) {
      this.logger.log(`Skipped ${skipped} overdue task(s): отключено в настройках или тихие часы`);
    }
    return { notified, skipped };
  }
}
