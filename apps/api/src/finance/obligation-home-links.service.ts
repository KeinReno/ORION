import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ObligationHomeLinks } from "./public/obligation-home-links";

@Injectable()
export class ObligationHomeLinksQueries extends ObligationHomeLinks {
  atHomeTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string) {
    return tx.financeObligation.findMany({ where: { workspaceId, homeId }, select: { id: true, closedAt: true } });
  }
  elsewhereTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string) {
    return tx.financeObligation.findMany({ where: { workspaceId, homeId: { not: null, notIn: [homeId] } }, select: { id: true } });
  }
  async setHomeTx(tx: Prisma.TransactionClient, workspaceId: string, id: string, homeId: string | null, requiredHomeId?: string) {
    return (await tx.financeObligation.updateMany({ where: { id, workspaceId, ...(requiredHomeId === undefined ? {} : { homeId: requiredHomeId }) }, data: { homeId } })).count;
  }
}
