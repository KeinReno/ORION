import type { Prisma } from "@prisma/client";

export type GoalTaskHistory = {
  projectId: string | null; status: string; createdAt: Date; completedAt: Date | null; updatedAt: Date;
};
export type GoalPlanTask = {
  id: string; projectId: string | null; milestoneId: string | null; title: string;
  status: string; priority: string; dueAt: Date | null; sortOrder: number; updatedAt: Date;
  dependsOn: Array<{ dependsOn: { status: string } }>;
};

/** Read-only goal planning projections. Uses the caller's authorized transaction. */
export abstract class GoalTaskReader {
  abstract historyTx(tx: Prisma.TransactionClient, workspaceId: string, projectIds: string[]): Promise<GoalTaskHistory[]>;
  abstract plansTx(tx: Prisma.TransactionClient, workspaceId: string, projectIds: string[]): Promise<GoalPlanTask[]>;
}
