import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { GoalTaskReader } from "./public/goal-task-reader";

@Injectable()
export class GoalTaskQueries extends GoalTaskReader {
  async historyTx(tx: Prisma.TransactionClient, workspaceId: string, projectIds: string[]) {
    return tx.task.findMany({
      where: { workspaceId, projectId: { in: projectIds } },
      select: { projectId: true, status: true, createdAt: true, completedAt: true, updatedAt: true }
    });
  }

  async plansTx(tx: Prisma.TransactionClient, workspaceId: string, projectIds: string[]) {
    return tx.task.findMany({
      where: { workspaceId, projectId: { in: projectIds } },
      select: {
        id: true, projectId: true, milestoneId: true, title: true, status: true,
        priority: true, dueAt: true, sortOrder: true, updatedAt: true,
        dependsOn: { select: { dependsOn: { select: { status: true } } } }
      }
    });
  }
}
