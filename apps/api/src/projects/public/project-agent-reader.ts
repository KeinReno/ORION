import type { Prisma } from "@prisma/client";

/** Project count for fences and bounded context titles, without aggregate queries. */
export abstract class ProjectAgentReader {
  abstract countTx(tx: Prisma.TransactionClient, workspaceId: string, ids: string[]): Promise<number>;
  abstract recentTx(tx: Prisma.TransactionClient, workspaceId: string, limit: number): Promise<Array<{ id: string; name: string }>>;
}
