import type { Prisma } from "@prisma/client";

/** Scoped existence projection; retains references while restoring lists. */
export abstract class TransactionReferences {
  abstract existingTx(tx: Prisma.TransactionClient, workspaceId: string, ids: string[]): Promise<Array<{ id: string }>>;
}
