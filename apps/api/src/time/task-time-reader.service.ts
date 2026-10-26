import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { TaskTimeReader } from "./public/task-time-reader";

@Injectable()
export class TaskTimeQueries extends TaskTimeReader {
  entriesTx(tx: Prisma.TransactionClient, workspaceId: string, taskIds: string[]) {
    return tx.timeEntry.findMany({ where: { workspaceId, taskId: { in: taskIds } }, select: { taskId: true, startedAt: true, endedAt: true } });
  }
}
