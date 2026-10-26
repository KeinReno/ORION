import type { Prisma } from "@prisma/client";

export type TaskTimeEntry = { taskId: string | null; startedAt: Date; endedAt: Date | null };
/** Read-only durations for contribution calculations, including a running timer. */
export abstract class TaskTimeReader {
  abstract entriesTx(tx: Prisma.TransactionClient, workspaceId: string, taskIds: string[]): Promise<TaskTimeEntry[]>;
}
