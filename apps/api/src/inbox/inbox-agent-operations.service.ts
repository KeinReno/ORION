import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { InboxAgentOperations, type AgentInboxInput } from "./public/inbox-agent-operations";

@Injectable()
export class InboxAgentWrites extends InboxAgentOperations {
  async createFromAgentTx(tx: Prisma.TransactionClient, workspaceId: string, input: AgentInboxInput) {
    return tx.inboxItem.create({ data: { workspaceId, title: input.title, body: input.body, kind: "inbox",
      dueAt: input.dueAt ? new Date(input.dueAt) : null, projectId: input.projectId, createdByAgent: input.agentName }, select: { id: true } });
  }
  referenceTx(tx: Prisma.TransactionClient, workspaceId: string, id: string) {
    return tx.inboxItem.findFirst({ where: { id, workspaceId }, select: { projectId: true } });
  }
}
