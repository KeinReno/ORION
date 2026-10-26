import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ProjectFinanceReader } from "./public/project-finance-reader";

/** Projects owns this query; .service.ts stays under architecture-check. */
@Injectable()
export class ProjectFinanceQueries extends ProjectFinanceReader {
  currencyTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string): Promise<{ currency: string } | null> {
    return tx.project.findFirst({ where: { id: projectId, workspaceId }, select: { currency: true } });
  }
}
