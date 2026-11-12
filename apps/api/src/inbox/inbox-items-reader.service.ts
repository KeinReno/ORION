import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { InboxItems, type InboxItemSnapshot } from "./public/inbox-items";

/** Реализация публичного чтения/удаления «Входящих» для соседних модулей (см. `public/inbox-items.ts`). */
@Injectable()
export class InboxItemsReader extends InboxItems {
  async readTx(tx: Prisma.TransactionClient, workspaceId: string, id: string): Promise<InboxItemSnapshot | null> {
    return tx.inboxItem.findFirst({
      where: { id, workspaceId },
      select: { id: true, title: true, body: true, projectId: true, createdByAgent: true, kind: true }
    });
  }

  async removeTx(tx: Prisma.TransactionClient, workspaceId: string, id: string): Promise<boolean> {
    const deleted = await tx.inboxItem.deleteMany({ where: { id, workspaceId } });
    return deleted.count > 0;
  }
}
