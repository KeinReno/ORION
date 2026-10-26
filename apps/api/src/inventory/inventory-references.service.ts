import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { InventoryReferences } from "./public/inventory-references";

@Injectable()
export class InventoryReferenceQueries extends InventoryReferences {
  itemsTx(tx: Prisma.TransactionClient, workspaceId: string, ids: string[]) {
    return tx.inventoryItem.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true } });
  }
  movementsTx(tx: Prisma.TransactionClient, workspaceId: string, ids: string[]) {
    return tx.inventoryMovement.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true } });
  }
}
