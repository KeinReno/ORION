import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { NoteAgentReferences } from "./public/note-agent-references";

@Injectable()
export class NoteAgentReferencesQueries extends NoteAgentReferences {
  referenceTx(tx: Prisma.TransactionClient, workspaceId: string, id: string) {
    return tx.note.findFirst({ where: { id, workspaceId }, select: { projectId: true } });
  }
  async snapshotTx(tx: Prisma.TransactionClient, workspaceId: string, id: string) {
    const row = await tx.note.findFirst({ where: { id, workspaceId, deletedAt: null }, select: { title: true, summary: true, body: true, tags: true, revision: true, updatedAt: true } });
    return row ? { title: row.title, current: { title: row.title, summary: row.summary, body: row.body, tags: row.tags }, revision: row.revision, updatedAt: row.updatedAt, readOnly: false } : null;
  }

}
