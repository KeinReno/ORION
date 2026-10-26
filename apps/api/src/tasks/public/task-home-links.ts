import type { Prisma } from "@prisma/client";
import type { TaskStatus } from "@orion/shared-types";

/** Home association operations owned by tasks; no change to caller access policy. */
export abstract class TaskHomeLinks {
  abstract atHomeTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string): Promise<Array<{ id: string; status: TaskStatus; updatedAt: Date }>>;
  abstract elsewhereTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string): Promise<Array<{ id: string }>>;
  abstract setHomeTx(tx: Prisma.TransactionClient, workspaceId: string, id: string, homeId: string | null, requiredHomeId?: string): Promise<number>;
  abstract contributionTasksTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string | null, windowStart: Date): Promise<Array<{ id: string; status: TaskStatus; completedAt: Date | null; dueAt: Date | null; assigneeId: string | null; estimatedMinutes: number | null }>>;
  abstract closersTx(tx: Prisma.TransactionClient, workspaceId: string, taskIds: string[]): Promise<Array<{ taskId: string; actorId: string | null }>>;
}
