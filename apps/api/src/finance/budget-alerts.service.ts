import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { budgetSpentTx, toMonthKey } from "./finance-refs.util";
import { NotificationCenterService } from "../notifications/notification-center.service";
import { NotificationPolicyService } from "../notifications/notification-policy.service";
import { TelegramService } from "../notifications/telegram.service";

/**
 * Budget-overrun alerts — the thing `UserPreference.financeAlerts` was
 * supposed to govern since v0.14, except nothing ever produced a finance
 * notification at all, so the toggle had nothing to switch off.
 *
 * Shape of the feature, deliberately small:
 *  - fired right after an expense is written (create or update of its lines),
 *    not by a cron — the moment the limit is crossed is the moment that
 *    matters, and it needs no extra pass over the data;
 *  - one alert per (budget, month): the dedup key is stored in the
 *    notification's `entityId` as `<budgetId>:<YYYY-MM>`, so editing the same
 *    transaction three times doesn't produce three alerts;
 *  - `evaluate` runs inside the caller's transaction and returns the message
 *    text; `deliver` sends it to Telegram *after* the commit, because doing
 *    network IO inside a DB transaction is how you get locks held by a
 *    hanging HTTP call (the crons draw the same line).
 */
@Injectable()
export class BudgetAlertsService {
  constructor(
    private readonly notifications: NotificationCenterService,
    private readonly policy: NotificationPolicyService,
    private readonly telegram: TelegramService
  ) {}

  /**
   * Checks every budget covering the given expense categories in that month.
   * Call inside an existing `withUser` transaction. Returns messages that
   * `deliver` should send once the transaction committed (may be empty).
   */
  async evaluate(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    categoryIds: (string | null)[],
    occurredAt: Date
  ): Promise<string[]> {
    const unique = [...new Set(categoryIds.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return [];
    // With the finance-budgeting plugin off, limits stay stored but raise nothing.
    const workspace = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { pluginOverrides: true } });
    if (workspace?.pluginOverrides.includes("finance-budgeting")) return [];

    const month = new Date(Date.UTC(occurredAt.getUTCFullYear(), occurredAt.getUTCMonth(), 1));
    const budgets = await tx.budget.findMany({ where: { workspaceId, categoryId: { in: unique }, month } });
    if (budgets.length === 0) return [];

    const recipientId = await this.policy.resolveOwnerId(workspaceId);
    if (!recipientId) return [];
    if (!(await this.policy.allowsForUser(recipientId, "finance"))) return [];

    const messages: string[] = [];
    for (const budget of budgets) {
      const spent = await budgetSpentTx(tx, workspaceId, budget.categoryId, budget.month);
      if (spent <= budget.limitAmount) continue;

      const entityId = `${budget.id}:${toMonthKey(budget.month)}`;
      const alreadyAlerted = await tx.notification.findFirst({
        where: { workspaceId, entityType: "budget", entityId },
        select: { id: true }
      });
      if (alreadyAlerted) continue;

      const category = await tx.financeCategory.findUnique({
        where: { id: budget.categoryId },
        select: { name: true }
      });
      const title = `Бюджет превышен: ${category?.name ?? "категория"}`;
      // Message text, not an API field: the "backend never formats money" rule
      // (v0.8) is about DTOs at the boundary — a Telegram line has to be human
      // readable, and the workspace's own currency is still the only one.
      const body = `Потрачено ${(spent / 100).toFixed(2)} из ${(budget.limitAmount / 100).toFixed(2)} ₽ за месяц`;

      await this.notifications.createTx(tx, {
        workspaceId,
        recipientId,
        kind: "finance_alert",
        eventKey: `finance_alert:${entityId}`,
        title,
        body,
        entityType: "budget",
        entityId
      });
      messages.push(`💸 ${title} — ${body}`);
    }
    return messages;
  }

  /** Best-effort Telegram delivery after the transaction committed; the in-app notification is already stored. */
  async deliver(messages: string[]): Promise<void> {
    for (const message of messages) {
      await this.telegram.sendMessage(message);
    }
  }
}
