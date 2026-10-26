import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { TaskProposalReader } from "./public/task-proposal-reader";

@Injectable()
export class TaskProposalQueries extends TaskProposalReader {
  async snapshotTx(tx: Prisma.TransactionClient, workspaceId: string, id: string) {
    const task = await tx.task.findFirst({ where: { id, workspaceId }, select: {
      title: true, description: true, status: true, priority: true, dueAt: true, revision: true, updatedAt: true
    } });
    return task ? { title: task.title, current: { title: task.title, description: task.description, status: task.status, priority: task.priority, dueAt: task.dueAt },
      revision: task.revision, updatedAt: task.updatedAt, readOnly: false } : null;
  }
}
