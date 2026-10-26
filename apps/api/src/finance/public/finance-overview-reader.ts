import type { Prisma } from "@prisma/client";
import type { MyOverview } from "@orion/shared-types";

export type OverviewAccount = Omit<MyOverview["accounts"][number], "workspaceName">;
/** Active account balances; caller supplies authorization, workspace and RLS transaction. */
export abstract class FinanceOverviewReader {
  abstract accountsTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<OverviewAccount[]>;
}
