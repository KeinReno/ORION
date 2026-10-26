import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { GoalReferences } from "./public/goal-references";

@Injectable()
export class GoalReferencesQueries extends GoalReferences {
  async existsTx(tx: Prisma.TransactionClient, workspaceId: string, goalId: string) {
    return !!await tx.goal.findFirst({ where: { id: goalId, workspaceId }, select: { id: true } });
  }
}
