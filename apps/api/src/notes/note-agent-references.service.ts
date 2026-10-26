import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { NoteAgentReferences } from "./public/note-agent-references";

@Injectable()
export class NoteAgentReferencesQueries extends NoteAgentReferences {
  referenceTx(tx: Prisma.TransactionClient, workspaceId: string, id: string) {
    return tx.note.findFirst({ where: { id, workspaceId }, select: { projectId: true } });
  }
}
