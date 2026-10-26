import type { Prisma } from "@prisma/client";

export type ExpenseProjection = { id: string; type: string; currency: string; totalMinor: number; note: string; occurredAt: string };
/** Public finance projection, in the caller's authorization/RLS context. */
export abstract class FinanceExpenseReader {
  abstract byIds(tx: Prisma.TransactionClient, workspaceId: string, ids: string[]): Promise<ExpenseProjection[]>;
}
