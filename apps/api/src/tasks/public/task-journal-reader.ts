import type { Prisma } from "@prisma/client";

export type TaskJournalChange = {
  id: string; field: string; fromValue: string | null; toValue: string | null;
  createdAt: Date; agentName: string | null; task: { id: string; title: string }; actor: { name: string } | null;
};
export type TaskJournalComment = {
  id: string; createdAt: Date; task: { id: string; title: string }; author: { name: string };
};
/** Task activity projections; module visibility is checked by the feed owner. */
export abstract class TaskJournalReader {
  abstract recentTx(tx: Prisma.TransactionClient, workspaceId: string, limit: number, homeId?: string): Promise<{ changes: TaskJournalChange[]; comments: TaskJournalComment[] }>;
}
