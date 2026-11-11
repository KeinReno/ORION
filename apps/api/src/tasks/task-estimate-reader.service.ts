import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { TaskEstimateReader, type TaskEstimate } from "./public/task-estimate-reader";

/** Владелец таблицы задач отдаёт только оценку и название (план/факт учёта времени). */
@Injectable()
export class TaskEstimateQueries extends TaskEstimateReader {
  async byIdsTx(tx: Prisma.TransactionClient, workspaceId: string, taskIds: readonly string[]): Promise<TaskEstimate[]> {
    if (taskIds.length === 0) return [];
    const rows = await tx.task.findMany({
      where: { workspaceId, id: { in: [...taskIds] } },
      select: { id: true, title: true, estimatedMinutes: true }
    });
    return rows.map((row) => ({ id: row.id, title: row.title, estimatedMinutes: row.estimatedMinutes }));
  }
}
