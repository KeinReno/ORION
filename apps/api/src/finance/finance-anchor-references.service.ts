import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { FinanceAnchorReferences } from "./public/finance-anchor-references";

@Injectable()
export class FinanceAnchorQueries extends FinanceAnchorReferences {
  async accountTx(tx: Prisma.TransactionClient, workspaceId: string, accountId: string) {
    return !!await tx.account.findFirst({ where: { id: accountId, workspaceId }, select: { id: true } });
  }
  async obligationTx(tx: Prisma.TransactionClient, workspaceId: string, obligationId: string) {
    return !!await tx.financeObligation.findFirst({ where: { id: obligationId, workspaceId }, select: { id: true } });
  }
}
