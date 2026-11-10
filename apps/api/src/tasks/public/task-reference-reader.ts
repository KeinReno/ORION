import type { Prisma } from "@prisma/client";

export type ProjectLogbookTaskReference = { id: string; title: string; status: string; projectId: string | null };

/** Read-only task projection for a project logbook, using the caller's authorized transaction. */
export abstract class TaskReferenceReader {
  abstract byIdsTx(tx: Prisma.TransactionClient, workspaceId: string, taskIds: string[]): Promise<ProjectLogbookTaskReference[]>;
}
