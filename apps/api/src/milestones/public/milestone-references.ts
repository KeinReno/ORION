import type { Prisma } from "@prisma/client";

/** Caller authorizes its command and supplies the existing transaction/RLS context. */
export abstract class MilestoneReferences {
  abstract findTx(tx: Prisma.TransactionClient, workspaceId: string, milestoneId: string): Promise<{ projectId: string } | null>;
}
