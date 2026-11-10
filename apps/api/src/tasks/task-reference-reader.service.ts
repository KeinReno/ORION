import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { TaskReferenceReader, type ProjectLogbookTaskReference } from "./public/task-reference-reader";

@Injectable()
export class TaskReferenceQueries extends TaskReferenceReader {
  async byIdsTx(tx: Prisma.TransactionClient, workspaceId: string, taskIds: string[]): Promise<ProjectLogbookTaskReference[]> {
    if (!taskIds.length) return [];
    return tx.task.findMany({
      where: { workspaceId, id: { in: taskIds } },
      select: { id: true, title: true, status: true, projectId: true }
    });
  }
}
