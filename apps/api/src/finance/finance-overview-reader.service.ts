import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { MyOverview } from "@orion/shared-types";
import { computeNetByAccount } from "./finance-refs.util";
import { FinanceOverviewReader, type OverviewAccount } from "./public/finance-overview-reader";

@Injectable()
export class FinanceOverviewQueries extends FinanceOverviewReader {
  async accountsTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<OverviewAccount[]> {
    const wsAccounts = await tx.account.findMany({ where: { workspaceId, archivedAt: null } });
    const netByAccount = await computeNetByAccount(tx, workspaceId);
    return wsAccounts.map(account => ({
      id: account.id,
      workspaceId: account.workspaceId,
      name: account.name,
      kind: account.kind as MyOverview["accounts"][number]["kind"],
      context: account.context as MyOverview["accounts"][number]["context"],
      visibility: account.visibility === "private" ? "private" : "workspace",
      ownerId: account.ownerId,
      currency: account.currency,
      startingBalance: account.startingBalance,
      balance: account.startingBalance + (netByAccount.get(account.id) ?? 0),
      archivedAt: null,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString()
    }));
  }
}
