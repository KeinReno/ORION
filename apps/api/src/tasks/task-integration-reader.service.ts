import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { TaskIntegrationReader, type DatedTask, type TaskReference } from "./public/task-integration-reader";

/** Tasks owns these projections; .service.ts keeps queries under architecture-check. */
@Injectable()
export class TaskIntegrationQueries extends TaskIntegrationReader {
  referenceTx(tx: Prisma.TransactionClient, workspaceId: string, taskId: string): Promise<TaskReference | null> {
    return tx.task.findFirst({ where: { id: taskId, workspaceId }, select: { id: true, projectId: true } });
  }
  datedTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<DatedTask[]> {
    return tx.task.findMany({ where: { workspaceId, dueAt: { not: null } },
      select: { id: true, dueAt: true, status: true, projectTag: true, title: true, description: true } });
  }
}
