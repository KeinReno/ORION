import type { Prisma } from "@prisma/client";

export type GoalPlanMilestone = { id: string; projectId: string; title: string; status: string; dueAt: Date | null };
/** Ordered milestone projection for goal plans, in the caller's RLS transaction. */
export abstract class GoalMilestoneReader {
  abstract plansTx(tx: Prisma.TransactionClient, workspaceId: string, projectIds: string[]): Promise<GoalPlanMilestone[]>;
}
