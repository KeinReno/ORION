import type { Prisma } from "@prisma/client";

/** Caller authorizes its command and supplies the existing transaction/RLS context. */
export abstract class ProjectTaskLinks {
  abstract byIdTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string): Promise<{ id: string; name: string } | null>;
  abstract findOrCreateByNameTx(tx: Prisma.TransactionClient, workspaceId: string, name: string): Promise<{ id: string; name: string }>;
}
