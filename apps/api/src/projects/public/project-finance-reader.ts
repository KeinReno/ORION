import type { Prisma } from "@prisma/client";

/** Narrow projection, no authorization grant. Caller supplies its transaction/RLS context. */
export abstract class ProjectFinanceReader {
  abstract currencyTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string): Promise<{ currency: string } | null>;
}
