import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { EventAgentReferences } from "./public/event-agent-references";

@Injectable()
export class EventAgentReferencesQueries extends EventAgentReferences {
  referenceTx(tx: Prisma.TransactionClient, workspaceId: string, id: string) {
    return tx.event.findFirst({ where: { id, workspaceId }, select: { projectId: true } });
  }
  async snapshotTx(tx: Prisma.TransactionClient, workspaceId: string, id: string) {
    const row = await tx.event.findFirst({ where: { id, workspaceId }, select: { title: true, description: true, location: true, startAt: true, endAt: true, allDay: true, reminders: true, projectId: true, updatedAt: true, readOnly: true } });
    return row ? { title: row.title, current: { title: row.title, description: row.description, location: row.location, startAt: row.startAt, endAt: row.endAt, allDay: row.allDay, reminders: row.reminders, projectId: row.projectId }, revision: null, updatedAt: row.updatedAt, readOnly: row.readOnly } : null;
  }

}
