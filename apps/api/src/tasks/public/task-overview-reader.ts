import type { Prisma } from "@prisma/client";
import type { MyOverview } from "@orion/shared-types";

export type OverviewTask = Omit<MyOverview["tasks"][number], "workspaceName">;
/** Assigned tasks for an already resolved membership, in the caller transaction. */
export abstract class TaskOverviewReader {
  abstract assignedTx(tx: Prisma.TransactionClient, workspaceId: string, assigneeId: string): Promise<OverviewTask[]>;
}
