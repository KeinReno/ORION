import type { Prisma } from "@prisma/client";

export type AgentJournalCall = { id: string; action: string; status: number; tokenName: string; createdAt: Date };
/** Agent call projection for the workspace activity feed. Caller owns authorization. */
export abstract class AgentJournalReader {
  abstract recentTx(tx: Prisma.TransactionClient, workspaceId: string, limit: number): Promise<AgentJournalCall[]>;
}
