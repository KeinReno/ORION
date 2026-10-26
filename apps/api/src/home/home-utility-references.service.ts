import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { HomeUtilityReferences } from "./public/home-utility-references";

@Injectable()
export class HomeUtilityReferenceQueries extends HomeUtilityReferences {
  async activeHomeTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string) {
    return !!await tx.home.findFirst({ where: { id: homeId, workspaceId, archivedAt: null }, select: { id: true } });
  }
  async electricityMeterTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string, meterId: string) {
    return !!await tx.meter.findFirst({ where: { id: meterId, workspaceId, homeId, kind: "electricity" }, select: { id: true } });
  }
}
