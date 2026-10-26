import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { GoalMilestoneReader } from "./public/goal-milestone-reader";

@Injectable()
export class GoalMilestoneQueries extends GoalMilestoneReader {
  async plansTx(tx: Prisma.TransactionClient, workspaceId: string, projectIds: string[]) {
    return tx.milestone.findMany({
      where: { workspaceId, projectId: { in: projectIds } },
      orderBy: [{ order: "asc" }, { dueAt: "asc" }, { createdAt: "asc" }],
      select: { id: true, projectId: true, title: true, status: true, dueAt: true }
    });
  }
}
