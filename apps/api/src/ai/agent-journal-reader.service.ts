import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AgentJournalReader } from "./public/agent-journal-reader";

@Injectable()
export class AgentJournalQueries extends AgentJournalReader {
  recentTx(tx: Prisma.TransactionClient, workspaceId: string, limit: number) {
    return tx.agentAuditEntry.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: limit,
      select: { id: true, action: true, status: true, tokenName: true, createdAt: true } });
  }
}
