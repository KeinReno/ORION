import type { Prisma } from "@prisma/client";
import type { ListItem } from "@orion/shared-types";

export type ShoppingEntry = { id: string; inventoryItemId: string | null; quantity: number; checked: boolean; stockedMovementId: string | null };
export type ShoppingList = { id: string; name: string; archivedAt: Date | null };
/** List side of the stock bridge. Caller supplies its authorized transaction. */
export abstract class ListShoppingCommands {
  abstract itemTx(tx: Prisma.TransactionClient, workspaceId: string, listId: string, itemId: string): Promise<ShoppingEntry>;
  abstract lockItemTx(tx: Prisma.TransactionClient, workspaceId: string, listId: string, itemId: string): Promise<ShoppingEntry>;
  abstract linkTx(tx: Prisma.TransactionClient, workspaceId: string, listId: string, itemId: string, inventoryItemId: string | null, quantity: number): Promise<ListItem>;
  abstract completePurchaseTx(tx: Prisma.TransactionClient, workspaceId: string, listId: string, itemId: string, userId: string, movementId: string | null): Promise<ListItem>;
  abstract listTx(tx: Prisma.TransactionClient, workspaceId: string, listId: string): Promise<ShoppingList>;
  abstract openTx(tx: Prisma.TransactionClient, workspaceId: string, listId: string, inventoryItemId: string): Promise<ListItem | null>;
  abstract addTx(tx: Prisma.TransactionClient, workspaceId: string, listId: string, inventoryItemId: string, label: string, quantity: number): Promise<ListItem>;
}
