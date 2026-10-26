import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ListShoppingCommands } from "./public/list-shopping-commands";
import { toItemDto } from "./lists.service";

const WHO = { checkedBy: { select: { name: true } } } as const;

@Injectable()
export class ListShoppingWrites extends ListShoppingCommands {
  async itemTx(tx: Prisma.TransactionClient, workspaceId: string, listId: string, itemId: string) {
    const item = await tx.listItem.findUnique({ where: { id: itemId },
      select: { id: true, workspaceId: true, listId: true, inventoryItemId: true, quantity: true, checked: true, stockedMovementId: true } });
    if (!item || item.workspaceId !== workspaceId || item.listId !== listId) throw new NotFoundException("Пункт списка не найден");
    return item;
  }
  async lockItemTx(tx: Prisma.TransactionClient, workspaceId: string, listId: string, itemId: string) {
    await tx.$queryRaw`SELECT id FROM "list_items" WHERE id = ${itemId} FOR UPDATE`;
    return this.itemTx(tx, workspaceId, listId, itemId);
  }
  async linkTx(tx: Prisma.TransactionClient, workspaceId: string, listId: string, itemId: string, inventoryItemId: string | null, quantity: number) {
    return toItemDto(await tx.listItem.update({ where: { id: itemId, workspaceId, listId }, data: { inventoryItemId, quantity }, include: WHO }));
  }
  async completePurchaseTx(tx: Prisma.TransactionClient, workspaceId: string, listId: string, itemId: string, userId: string, movementId: string | null) {
    const item = await this.itemTx(tx, workspaceId, listId, itemId);
    if (movementId === null && item.checked) return toItemDto(await tx.listItem.findUniqueOrThrow({ where: { id: itemId }, include: WHO }));
    return toItemDto(await tx.listItem.update({ where: { id: itemId }, data: {
      checked: true, ...(movementId === null ? {} : { stockedMovementId: movementId }),
      ...(item.checked ? {} : { checkedAt: new Date(), checkedById: userId })
    }, include: WHO }));
  }
  async listTx(tx: Prisma.TransactionClient, workspaceId: string, listId: string) {
    const list = await tx.list.findFirst({ where: { id: listId, workspaceId }, select: { id: true, name: true, archivedAt: true } });
    if (!list) throw new NotFoundException("Список не найден");
    return list;
  }
  async openTx(tx: Prisma.TransactionClient, workspaceId: string, listId: string, inventoryItemId: string) {
    const item = await tx.listItem.findFirst({ where: { workspaceId, listId, inventoryItemId, checked: false }, include: WHO });
    return item ? toItemDto(item) : null;
  }
  async addTx(tx: Prisma.TransactionClient, workspaceId: string, listId: string, inventoryItemId: string, label: string, quantity: number) {
    const last = await tx.listItem.aggregate({ where: { listId }, _max: { sortOrder: true } });
    return toItemDto(await tx.listItem.create({ data: { workspaceId, listId, label, inventoryItemId, quantity, sortOrder: (last._max.sortOrder ?? 0) + 10 }, include: WHO }));
  }
}
