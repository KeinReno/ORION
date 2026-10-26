import type { Prisma } from "@prisma/client";
import type { ListItem } from "@orion/shared-types";

export type ExpenseListSelection = { name: string; items: Array<{ id: string; checked: boolean; priceMinor: number | null; expenseTransactionId: string | null }> };
/** Lists-owned locking and link writes. Finance bridge retains amount and booking policy. */
export abstract class ListExpenseCommands {
  abstract lockSelectionTx(tx: Prisma.TransactionClient, workspaceId: string, listId: string, itemIds: string[]): Promise<ExpenseListSelection>;
  abstract completeTx(tx: Prisma.TransactionClient, workspaceId: string, listId: string, userId: string, itemIds: string[], transactionId: string): Promise<ListItem[]>;
}
