import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { HomeReferences } from "./public/home-references";

@Injectable()
export class HomeReferencesQueries extends HomeReferences {
  async existsTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string) {
    return !!await tx.home.findFirst({ where: { id: homeId, workspaceId }, select: { id: true } });
  }
}
