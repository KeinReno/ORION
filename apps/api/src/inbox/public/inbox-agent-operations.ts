import type { Prisma } from "@prisma/client";

export type AgentInboxInput = { title: string; body: string; dueAt: string | null; projectId: string | null; agentName: string };
/** Agent capture commands, in the caller's authorized transaction. */
export abstract class InboxAgentOperations {
  abstract createFromAgentTx(tx: Prisma.TransactionClient, workspaceId: string, input: AgentInboxInput): Promise<{ id: string }>;
  abstract referenceTx(tx: Prisma.TransactionClient, workspaceId: string, id: string): Promise<{ projectId: string | null } | null>;
}
