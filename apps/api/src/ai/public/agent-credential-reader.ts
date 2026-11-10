import type { Prisma } from "@prisma/client";

export type OwnedAgentCredential = { id: string; name: string; scopes: string[]; expiresAt: Date | null };
export type AgentCredentialState = "active" | "revoked" | "expired" | "missing";

/** Safe projection for an explicitly owned, active AI Bridge credential; never returns its hash or secret. */
export abstract class AgentCredentialReader {
  abstract listOwnedActiveTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string): Promise<OwnedAgentCredential[]>;
  abstract resolveOwnedActiveTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, tokenIds: string[]): Promise<OwnedAgentCredential[]>;
  abstract stateTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, tokenId: string): Promise<AgentCredentialState>;
}
