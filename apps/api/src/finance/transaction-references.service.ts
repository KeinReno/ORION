import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { TransactionReferences } from "./public/transaction-references";

@Injectable()
export class TransactionReferenceQueries extends TransactionReferences {
  existingTx(tx: Prisma.TransactionClient, workspaceId: string, ids: string[]) {
    return tx.transaction.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true } });
  }
}
