import type { Prisma } from "@prisma/client";

/** Read-only reference contract. Caller authorizes its command and supplies the
 * existing transaction/RLS context. No project details or extra authority. */
export abstract class ProjectReferences {
  abstract existsTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string): Promise<boolean>;
}
