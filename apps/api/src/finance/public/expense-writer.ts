import type { Prisma } from "@prisma/client";

export interface WriteExpenseInput {
  accountId: string;
  categoryId: string | null;
  /** Minor units, positive. */
  amountMinor: number;
  occurredAt: Date;
  note: string;
  tags?: string[];
}


/** Caller owns authorization and transaction; deliver alerts only after commit. */
export abstract class FinanceExpenseWriter {
  abstract createExpenseTx(tx: Prisma.TransactionClient, workspaceId: string, input: WriteExpenseInput): Promise<{ transactionId: string; alerts: string[] }>;
  abstract deliver(alerts: string[]): Promise<void>;
}
