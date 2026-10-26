import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { TASK_CLOSED_STATUSES } from "@orion/shared-types";
import { TaskHomeLinks } from "./public/task-home-links";

@Injectable()
export class TaskHomeLinksQueries extends TaskHomeLinks {
  atHomeTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string) {
    return tx.task.findMany({ where: { workspaceId, homeId }, select: { id: true, status: true, updatedAt: true }, take: 500 });
  }
  elsewhereTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string) {
    return tx.task.findMany({ where: { workspaceId, homeId: { not: null, notIn: [homeId] } }, select: { id: true } });
  }
  async setHomeTx(tx: Prisma.TransactionClient, workspaceId: string, id: string, homeId: string | null, requiredHomeId?: string) {
    return (await tx.task.updateMany({ where: { id, workspaceId, ...(requiredHomeId === undefined ? {} : { homeId: requiredHomeId }) }, data: { homeId } })).count;
  }
  contributionTasksTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string | null, windowStart: Date) {
    return tx.task.findMany({ where: { workspaceId, homeId: homeId ?? { not: null },
      OR: [{ status: "done", completedAt: { gte: windowStart } }, { status: { notIn: [...TASK_CLOSED_STATUSES] } }] },
      select: { id: true, status: true, completedAt: true, dueAt: true, assigneeId: true, estimatedMinutes: true }, take: 5000 });
  }
  closersTx(tx: Prisma.TransactionClient, workspaceId: string, taskIds: string[]) {
    return tx.taskActivity.findMany({ where: { workspaceId, taskId: { in: taskIds }, field: "status", toValue: "done" },
      orderBy: { createdAt: "asc" }, select: { taskId: true, actorId: true } });
  }
}
