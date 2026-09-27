import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { NotificationCenterService } from "../notifications/notification-center.service";
import { NotificationPolicyService } from "../notifications/notification-policy.service";
import { TelegramService } from "../notifications/telegram.service";

export interface LowStockItem {
  id: string;
  workspaceId: string;
  name: string;
  unit: string;
  minStock: number | null;
  lowStockNotifiedAt: Date | null;
}

/**
 * Low-stock alerts — same shape as `BudgetAlertsService` (see its comment):
 * fired right after a movement is written, inside the caller's transaction,
 * not by a cron, because the moment the threshold is crossed is the moment
 * that matters.
 *
 * Dedup isn't a `(item, period)` key like budgets (there's no month
 * boundary here) — it's `InventoryItem.lowStockNotifiedAt`, cleared the
 * moment a receipt brings the balance back above `minStock`. Crossing down
 * again after that is a new event and alerts again; staying below it after
 * the first alert never repeats.
 */
@Injectable()
export class InventoryAlertsService {
  constructor(
    private readonly notifications: NotificationCenterService,
    private readonly policy: NotificationPolicyService,
    private readonly telegram: TelegramService
  ) {}

  /** Call inside an existing `withUser` transaction, right after the movement that changed `balance` landed. */
  async evaluateTx(tx: Prisma.TransactionClient, item: LowStockItem, balance: number): Promise<string | null> {
    if (item.minStock === null) return null;

    if (balance > item.minStock) {
      if (item.lowStockNotifiedAt !== null) {
        await tx.inventoryItem.update({ where: { id: item.id }, data: { lowStockNotifiedAt: null } });
      }
      return null;
    }

    // Still below the threshold, but already alerted once since the last time it recovered.
    if (item.lowStockNotifiedAt !== null) return null;
    const recipientId = await this.policy.resolveOwnerId(item.workspaceId);
    if (!recipientId) return null;
    if (!(await this.policy.allowsForUser(recipientId, "inventory"))) return null;

    const title = `Низкий остаток: ${item.name}`;
    const body = `Осталось ${balance} ${item.unit} (порог ${item.minStock} ${item.unit})`;
    await this.notifications.createTx(tx, {
      workspaceId: item.workspaceId,
      recipientId,
      kind: "inventory_low_stock",
      // No eventKey: dedup for this producer is `InventoryItem.lowStockNotifiedAt`
      // (cleared on recovery, so a stable eventKey would block every future
      // episode after the first) — it's mutation-triggered, not a cron tick
      // that needs the (recipient, eventKey) unique index as a backstop.
      title,
      body,
      entityType: "inventory_item",
      entityId: item.id
    });
    await tx.inventoryItem.update({ where: { id: item.id }, data: { lowStockNotifiedAt: new Date() } });
    return `📦 ${title} — ${body}`;
  }

  /** Best-effort Telegram delivery after the transaction committed — see BudgetAlertsService.deliver. */
  async deliver(message: string | null): Promise<void> {
    if (message) await this.telegram.sendMessage(message);
  }
}
