import type { Prisma } from "@prisma/client";

export type TaskReference = { id: string; projectId: string | null };
export type DatedTask = {
  id: string; dueAt: Date | null; status: string; projectTag: string | null;
  title: string; description: string;
};

/** Read-only projections in the caller's transaction/RLS context. No authorization grant. */
export abstract class TaskIntegrationReader {
  abstract referenceTx(tx: Prisma.TransactionClient, workspaceId: string, taskId: string): Promise<TaskReference | null>;
  abstract datedTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<DatedTask[]>;
}
