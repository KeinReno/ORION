import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { TaskJournalReader } from "./public/task-journal-reader";

@Injectable()
export class TaskJournalQueries extends TaskJournalReader {
  async recentTx(tx: Prisma.TransactionClient, workspaceId: string, limit: number, homeId?: string) {
    const where = { workspaceId, ...(homeId === undefined ? {} : { task: { homeId } }) };
    const [changes, comments] = await Promise.all([
      tx.taskActivity.findMany({ where, orderBy: { createdAt: "desc" }, take: limit,
        select: { id: true, field: true, fromValue: true, toValue: true, createdAt: true, agentName: true,
          task: { select: { id: true, title: true } }, actor: { select: { name: true } } } }),
      tx.taskComment.findMany({ where, orderBy: { createdAt: "desc" }, take: limit,
        select: { id: true, createdAt: true, task: { select: { id: true, title: true } }, author: { select: { name: true } } } })
    ]);
    return { changes, comments };
  }
}
