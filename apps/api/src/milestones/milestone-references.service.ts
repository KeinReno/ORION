import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { MilestoneReferences } from "./public/milestone-references";

@Injectable()
export class MilestoneReferenceQueries extends MilestoneReferences {
  findTx(tx: Prisma.TransactionClient, workspaceId: string, milestoneId: string): Promise<{ projectId: string } | null> {
    return tx.milestone.findFirst({ where: { id: milestoneId, workspaceId }, select: { projectId: true } });
  }
}
