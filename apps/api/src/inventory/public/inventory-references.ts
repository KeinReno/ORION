import type { Prisma } from "@prisma/client";

/** Reference validation for restored list items, without granting Inventory access. */
export abstract class InventoryReferences {
  abstract itemsTx(tx: Prisma.TransactionClient, workspaceId: string, ids: string[]): Promise<Array<{ id: string }>>;
  abstract movementsTx(tx: Prisma.TransactionClient, workspaceId: string, ids: string[]): Promise<Array<{ id: string }>>;
}
