import type { Prisma } from "@prisma/client";

/** Capture anchor existence only. Caller retains module/permission policy. */
export abstract class FinanceAnchorReferences {
  abstract accountTx(tx: Prisma.TransactionClient, workspaceId: string, accountId: string): Promise<boolean>;
  abstract obligationTx(tx: Prisma.TransactionClient, workspaceId: string, obligationId: string): Promise<boolean>;
}
