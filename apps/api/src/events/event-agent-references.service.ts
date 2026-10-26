import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { EventAgentReferences } from "./public/event-agent-references";

@Injectable()
export class EventAgentReferencesQueries extends EventAgentReferences {
  referenceTx(tx: Prisma.TransactionClient, workspaceId: string, id: string) {
    return tx.event.findFirst({ where: { id, workspaceId }, select: { projectId: true } });
  }
}
