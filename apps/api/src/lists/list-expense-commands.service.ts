import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ListExpenseCommands } from "./public/list-expense-commands";
import { ITEMS_INCLUDE, toItemDto } from "./lists.service";

@Injectable()
export class ListExpenseWrites extends ListExpenseCommands {
  async lockSelectionTx(tx: Prisma.TransactionClient, workspaceId: string, listId: string, itemIds: string[]) {
    const list = await tx.list.findUnique({ where: { id: listId } });
    if (!list || list.workspaceId !== workspaceId) throw new NotFoundException("Список не найден");
    await tx.$queryRaw`SELECT id FROM "list_items" WHERE id = ANY(${itemIds}::text[]) FOR UPDATE`;
    const items = await tx.listItem.findMany({ where: { id: { in: itemIds } },
      select: { id: true, workspaceId: true, listId: true, checked: true, priceMinor: true, expenseTransactionId: true } });
    if (items.length !== itemIds.length || items.some(item => item.workspaceId !== workspaceId || item.listId !== listId)) {
      throw new NotFoundException("Пункт списка не найден");
    }
    return { name: list.name, items };
  }
  async completeTx(tx: Prisma.TransactionClient, workspaceId: string, listId: string, userId: string, itemIds: string[], transactionId: string) {
    const items = await tx.listItem.findMany({ where: { workspaceId, listId, id: { in: itemIds } }, select: { id: true, checked: true } });
    const now = new Date();
    for (const item of items) await tx.listItem.update({ where: { id: item.id }, data: {
      expenseTransactionId: transactionId, checked: true, ...(item.checked ? {} : { checkedAt: now, checkedById: userId })
    } });
    const fresh = await tx.list.findUniqueOrThrow({ where: { id: listId }, include: ITEMS_INCLUDE });
    const booked = new Set(itemIds);
    return fresh.items.filter(item => booked.has(item.id)).map(toItemDto);
  }
}
