import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { TelegramService } from "./telegram.service";

type OverdueTask = Prisma.TaskGetPayload<{ include: { workspace: true } }>;

const OVERDUE_WHERE = {
  dueAt: { lte: new Date() },
  notifiedAt: null,
  status: { not: "done" as const }
};

@Injectable()
export class DueTaskCheckerService {
  private readonly logger = new Logger(DueTaskCheckerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService
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
  async runCheck(): Promise<{ notified: number }> {
    const overdue = await this.prisma.asSystem((tx) =>
      tx.task.findMany({ where: OVERDUE_WHERE, include: { workspace: true } })
    );
    return this.notifyAndMark(overdue, (fn) => this.prisma.asSystem(fn));
  }

  /** Scoped to one user's own workspaces — this is what POST /notifications/check-due uses, so a user can only ever trigger reminders for their own data. */
  async runCheckForUser(userId: string): Promise<{ notified: number }> {
    const overdue = await this.prisma.withUser(userId, (tx) =>
      tx.task.findMany({ where: OVERDUE_WHERE, include: { workspace: true } })
    );
    return this.notifyAndMark(overdue, (fn) => this.prisma.withUser(userId, fn));
  }

  private async notifyAndMark(
    tasks: OverdueTask[],
    scoped: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>
  ): Promise<{ notified: number }> {
    let notified = 0;
    for (const task of tasks) {
      const label = task.projectTag ? `[${task.projectTag}] ` : "";
      const delivered = await this.telegram.sendMessage(
        `⏰ Просрочена задача: ${label}${task.title} (пространство: ${task.workspace.name})`
      );
      // Only mark as notified if delivery actually succeeded — otherwise the
      // reminder would be silently lost forever on the next cron tick.
      if (!delivered) continue;
      await scoped((tx) => tx.task.update({ where: { id: task.id }, data: { notifiedAt: new Date() } }));
      notified++;
    }
    if (notified > 0) {
      this.logger.log(`Notified about ${notified} overdue task(s)`);
    }
    return { notified };
  }
}
