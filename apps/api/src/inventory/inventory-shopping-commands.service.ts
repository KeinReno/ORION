import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { InventoryService, toMovementDto } from "./inventory.service";
import { InventoryShoppingCommands } from "./public/inventory-shopping-commands";

@Injectable()
export class InventoryShoppingWrites extends InventoryShoppingCommands {
  constructor(private readonly inventory: InventoryService) { super(); }
  async itemTx(tx: Prisma.TransactionClient, workspaceId: string, itemId: string) {
    const stock = await tx.inventoryItem.findFirst({ where: { id: itemId, workspaceId }, select: { id: true, name: true, minStock: true, archivedAt: true } });
    if (!stock) throw new NotFoundException("Позиция склада не найдена");
    return stock;
  }
  async lockItemTx(tx: Prisma.TransactionClient, workspaceId: string, itemId: string) {
    await tx.$queryRaw`SELECT id FROM "inventory_items" WHERE id = ${itemId} FOR UPDATE`;
    return this.itemTx(tx, workspaceId, itemId);
  }
  async balanceTx(tx: Prisma.TransactionClient, workspaceId: string, itemId: string) {
    return (await tx.inventoryMovement.aggregate({ where: { workspaceId, itemId }, _sum: { quantity: true } }))._sum.quantity ?? 0;
  }
  async receiveTx(tx: Prisma.TransactionClient, workspaceId: string, itemId: string, quantity: number, note: string) {
    const { movement, alert } = await this.inventory.recordMovementTx(tx, workspaceId, itemId, { type: "receipt", quantity, direction: "+", note });
    return { movement: toMovementDto(movement), alert };
  }
  deliverAlert(alert: string | null) { return this.inventory.deliverAlert(alert); }
}
