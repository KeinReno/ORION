import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AgentToken as TokenRow } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import {
  AGENT_TOKEN_PREFIX,
  agentScopeSchema,
  type AgentAuditEntry,
  type AgentMessage,
  type AgentPeer,
  type SendAgentMessageInput,
  type AgentScope,
  type AgentToken,
  type CreateAgentTokenInput,
  type CreatedAgentToken
} from "@orion/shared-types";
import { isServerMode } from "../common/orion-mode";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

const DAY_MS = 24 * 60 * 60 * 1000;
/** `lastUsedAt` is a hint, not a log: don't write on every call. */
const LAST_USED_GRANULARITY_MS = 60_000;

/** In `server` mode the bridge is opt-in (`ORION_AI_BRIDGE=1`); on a personal machine it is on. */
export function aiBridgeEnabled(): boolean {
  return !isServerMode() || process.env.ORION_AI_BRIDGE === "1";
}

export function hashAgentSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** What an authenticated agent request carries: whose rights, where, and for what. */
export interface AgentContext {
  tokenId: string;
  tokenName: string;
  workspaceId: string;
  /** The member the token acts as — every service call runs with this user's RLS context. */
  userId: string;
  scopes: AgentScope[];
}

/**
 * Issuing, listing, revoking and authenticating agent tokens (ADR-0007). The secret is
 * random, shown once and stored only as a sha256 — it is high-entropy, so a fast hash is
 * the right tool (no password-style stretching needed).
 */
@Injectable()
export class AgentTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async create(userId: string, workspaceId: string, input: CreateAgentTokenInput): Promise<CreatedAgentToken> {
    if (!aiBridgeEnabled()) throw new ForbiddenException("AI Bridge выключен на этом сервере (ORION_AI_BRIDGE=1 включает)");
    const secret = `${AGENT_TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.agentToken.create({
        data: {
          workspaceId,
          createdById: userId,
          name: input.name,
          tokenHash: hashAgentSecret(secret),
          prefix: secret.slice(0, AGENT_TOKEN_PREFIX.length + 4),
          scopes: [...new Set(input.scopes)],
          expiresAt: new Date(Date.now() + input.expiresInDays * DAY_MS)
        }
      });
    });
    return { ...toDto(row), secret };
  }

  /** Only the caller's own tokens: a token is that person's delegated access. */
  async list(userId: string, workspaceId: string): Promise<AgentToken[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.agentToken.findMany({ where: { workspaceId, createdById: userId }, orderBy: { createdAt: "desc" } });
    });
    return rows.map(toDto);
  }

  async revoke(userId: string, workspaceId: string, tokenId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const result = await tx.agentToken.updateMany({
        where: { id: tokenId, workspaceId, createdById: userId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      if (result.count === 0) throw new NotFoundException("Токен не найден");
    });
  }

  async audit(userId: string, workspaceId: string): Promise<AgentAuditEntry[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.agentAuditEntry.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 200 });
    });
    return rows.map((r) => ({
      id: r.id,
      tokenId: r.tokenId,
      tokenName: r.tokenName,
      action: r.action,
      resource: r.resource,
      status: r.status,
      createdAt: r.createdAt.toISOString()
    }));
  }

  /** Resolve a presented secret. `null` for anything unknown, revoked or expired — no reason is leaked. */
  async authenticate(secret: string): Promise<AgentContext | null> {
    if (!aiBridgeEnabled() || !secret.startsWith(AGENT_TOKEN_PREFIX)) return null;
    const hash = hashAgentSecret(secret);
    // No user yet, so no RLS context: this lookup is the one place that is allowed to bypass it.
    const row = await this.prisma.asSystem((tx) => tx.agentToken.findUnique({ where: { tokenHash: hash } }));
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) return null;
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_GRANULARITY_MS) {
      await this.prisma.asSystem((tx) => tx.agentToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }));
    }
    return {
      tokenId: row.id,
      tokenName: row.name,
      workspaceId: row.workspaceId,
      userId: row.createdById,
      scopes: row.scopes.filter((s): s is AgentScope => agentScopeSchema.safeParse(s).success)
    };
  }

  /** Other live agents of the same workspace this agent may write to. */
  async peers(agent: AgentContext): Promise<AgentPeer[]> {
    const rows = await this.prisma.withUser(agent.userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, agent.userId, agent.workspaceId);
      return tx.agentToken.findMany({
        where: {
          workspaceId: agent.workspaceId,
          id: { not: agent.tokenId },
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        },
        orderBy: { name: "asc" }
      });
    });
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }

  async sendMessage(agent: AgentContext, input: SendAgentMessageInput): Promise<AgentMessage> {
    if (input.toTokenId === agent.tokenId) throw new BadRequestException("Нельзя написать самому себе");
    const row = await this.prisma.withUser(agent.userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, agent.userId, agent.workspaceId);
      const target = await tx.agentToken.findUnique({ where: { id: input.toTokenId } });
      const alive = target && !target.revokedAt && (!target.expiresAt || target.expiresAt.getTime() > Date.now());
      if (!target || target.workspaceId !== agent.workspaceId || !alive) throw new NotFoundException("Агент не найден");
      return tx.agentMessage.create({
        data: { workspaceId: agent.workspaceId, fromTokenId: agent.tokenId, toTokenId: target.id, subject: input.subject, body: input.body }
      });
    });
    return { id: row.id, fromTokenId: row.fromTokenId, fromName: agent.tokenName, toTokenId: row.toTokenId, subject: row.subject, body: row.body, createdAt: row.createdAt.toISOString(), readAt: null };
  }

  /** This agent's own inbox, unread first. Bodies are untrusted text from another agent — data, not orders. */
  async inbox(agent: AgentContext): Promise<AgentMessage[]> {
    const rows = await this.prisma.withUser(agent.userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, agent.userId, agent.workspaceId);
      return tx.agentMessage.findMany({
        where: { workspaceId: agent.workspaceId, toTokenId: agent.tokenId },
        include: { from: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 50
      });
    });
    const dto = rows.map((r) => ({
      id: r.id,
      fromTokenId: r.fromTokenId,
      fromName: r.from.name,
      toTokenId: r.toTokenId,
      subject: r.subject,
      body: r.body,
      createdAt: r.createdAt.toISOString(),
      readAt: r.readAt?.toISOString() ?? null
    }));
    return [...dto.filter((m) => m.readAt === null), ...dto.filter((m) => m.readAt !== null)];
  }

  async markRead(agent: AgentContext, messageId: string): Promise<void> {
    await this.prisma.withUser(agent.userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, agent.userId, agent.workspaceId);
      const result = await tx.agentMessage.updateMany({
        where: { id: messageId, workspaceId: agent.workspaceId, toTokenId: agent.tokenId, readAt: null },
        data: { readAt: new Date() }
      });
      if (result.count === 0) {
        const exists = await tx.agentMessage.findFirst({ where: { id: messageId, workspaceId: agent.workspaceId, toTokenId: agent.tokenId } });
        if (!exists) throw new NotFoundException("Сообщение не найдено");
      }
    });
  }

  async record(agent: AgentContext, action: string, resource: string | null, status: number): Promise<void> {
    await this.prisma.asSystem((tx) =>
      tx.agentAuditEntry.create({
        data: { workspaceId: agent.workspaceId, tokenId: agent.tokenId, tokenName: agent.tokenName, action, resource, status }
      })
    );
  }
}

function toDto(row: TokenRow): AgentToken {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes.filter((s): s is AgentScope => agentScopeSchema.safeParse(s).success),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString()
  };
}
