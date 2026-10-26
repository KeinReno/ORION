import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { InventoryHomeLinks } from "./public/inventory-home-links";

@Injectable()
export class InventoryHomeLinksQueries extends InventoryHomeLinks {
  atHomeTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string) {
    return tx.inventoryItem.findMany({ where: { workspaceId, homeId, archivedAt: null }, select: { id: true } });
  }
  elsewhereTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string) {
    return tx.inventoryItem.findMany({ where: { workspaceId, homeId: { not: null, notIn: [homeId] }, archivedAt: null }, select: { id: true } });
  }
  async setHomeTx(tx: Prisma.TransactionClient, workspaceId: string, id: string, homeId: string | null, requiredHomeId?: string) {
    return (await tx.inventoryItem.updateMany({ where: { id, workspaceId, ...(requiredHomeId === undefined ? {} : { homeId: requiredHomeId }) }, data: { homeId } })).count;
  }
}
