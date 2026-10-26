import type { Prisma } from "@prisma/client";
import type { InventoryMovement } from "@orion/shared-types";

export type ShoppingStock = { id: string; name: string; minStock: number | null; archivedAt: Date | null };
/** Stock-owned reference, locking, balance and receipt operations for shopping. */
export abstract class InventoryShoppingCommands {
  abstract itemTx(tx: Prisma.TransactionClient, workspaceId: string, itemId: string): Promise<ShoppingStock>;
  abstract lockItemTx(tx: Prisma.TransactionClient, workspaceId: string, itemId: string): Promise<ShoppingStock>;
  abstract balanceTx(tx: Prisma.TransactionClient, workspaceId: string, itemId: string): Promise<number>;
  abstract receiveTx(tx: Prisma.TransactionClient, workspaceId: string, itemId: string, quantity: number, note: string): Promise<{ movement: InventoryMovement; alert: string | null }>;
  abstract deliverAlert(alert: string | null): Promise<void>;
}
