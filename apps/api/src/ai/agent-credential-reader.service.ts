import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AgentCredentialReader, type AgentCredentialState, type OwnedAgentCredential } from "./public/agent-credential-reader";

@Injectable()
export class AgentCredentialQueries extends AgentCredentialReader {
  async stateTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, tokenId: string): Promise<AgentCredentialState> {
    const token = await tx.agentToken.findFirst({ where: { id: tokenId, workspaceId, createdById: userId }, select: { revokedAt: true, expiresAt: true, scopes: true } });
    if (!token) return "missing";
    if (token.revokedAt) return "revoked";
    if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) return "expired";
    if (!token.scopes.includes("tasks:read") || !token.scopes.includes("agent-hub.execution.create")) return "missing";
    return "active";
  }
  listOwnedActiveTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string): Promise<OwnedAgentCredential[]> {
    return tx.agentToken.findMany({
      where: { workspaceId, createdById: userId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], scopes: { has: "tasks:read" } },
      select: { id: true, name: true, scopes: true, expiresAt: true }, orderBy: { name: "asc" }
    });
  }
  resolveOwnedActiveTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, tokenIds: string[]): Promise<OwnedAgentCredential[]> {
    return tx.agentToken.findMany({
      where: { id: { in: tokenIds }, workspaceId, createdById: userId, revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        AND: [{ scopes: { has: "tasks:read" } }, { scopes: { has: "agent-hub.execution.create" } }] },
      select: { id: true, name: true, scopes: true, expiresAt: true }
    });
  }
}
