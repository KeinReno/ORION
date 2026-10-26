import type { Prisma } from "@prisma/client";

/** Existence only; archived references retain the existing capture policy. */
export abstract class GoalReferences {
  abstract existsTx(tx: Prisma.TransactionClient, workspaceId: string, goalId: string): Promise<boolean>;
}
