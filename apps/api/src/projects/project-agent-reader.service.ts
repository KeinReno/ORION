import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ProjectAgentReader } from "./public/project-agent-reader";

@Injectable()
export class ProjectAgentQueries extends ProjectAgentReader {
  countTx(tx: Prisma.TransactionClient, workspaceId: string, ids: string[]) {
    return tx.project.count({ where: { workspaceId, id: { in: ids } } });
  }
  recentTx(tx: Prisma.TransactionClient, workspaceId: string, limit: number) {
    return tx.project.findMany({ where: { workspaceId, archivedAt: null }, orderBy: { updatedAt: "desc" }, take: limit, select: { id: true, name: true } });
  }
}
