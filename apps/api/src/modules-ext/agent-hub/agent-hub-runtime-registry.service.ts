import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AgentHubRuntimeSession as RuntimeRow } from "@prisma/client";
import type { AgentContext } from "../../ai/agent-tokens.service";
import { PrismaService } from "../../common/prisma.service";
import { ModulesService } from "../../modules/modules.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import {
  agentHubRuntimeSessionSchema,
  type AgentHubRuntimeSession,
  type AgentHubRuntimeRegisterInput
} from "@orion/shared-types";

const PRESENCE_TTL_MS = 300_000;
const MAX_ACTIVE_SESSIONS_PER_TOKEN = 4;

function dto(row: RuntimeRow, now = Date.now()): AgentHubRuntimeSession {
  const presence = row.status === "closed"
    ? "closed"
    : row.expiresAt.getTime() > now ? "recent" : "stale";
  return agentHubRuntimeSessionSchema.parse({
    id: row.id, workspaceId: row.workspaceId, tokenId: row.tokenId,
    kind: row.kind, capabilities: row.capabilities, revision: row.revision,
    startedAt: row.startedAt.toISOString(), lastHeartbeatAt: row.lastHeartbeatAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(), presence
  });
}

/**
 * Reported runtime presence only. Bearer token != process attestation.
 * All writes are scoped, CAS-protected and audited by AgentModuleToolsService.
 */
@Injectable()
export class AgentHubRuntimeRegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService
  ) {}

  private async checkAgent(agent: AgentContext): Promise<void> {
    if (!agent.scopes.includes("tasks:read")) throw new ForbiddenException("Нужно разрешение tasks:read");
    await this.modules.assertEnabled(agent.userId, agent.workspaceId, "agent-hub");
  }

  async register(agent: AgentContext, input: AgentHubRuntimeRegisterInput): Promise<AgentHubRuntimeSession> {
    await this.checkAgent(agent);
    return this.prisma.withUser(agent.userId, async tx => {
      await this.workspaces.assertMemberTx(tx, agent.userId, agent.workspaceId);
      const existing = await tx.agentHubRuntimeSession.findUnique({ where: { id: input.sessionId } });
      if (existing) {
        if (existing.workspaceId !== agent.workspaceId || existing.tokenId !== agent.tokenId) {
          throw new ForbiddenException("Чужая сессия runtime");
        }
        if (existing.status !== "active" || existing.expiresAt.getTime() <= Date.now()) {
          throw new ConflictException("Сессия истекла: создайте новую");
        }
        return dto(existing);
      }
      const now = new Date();
      const active = await tx.agentHubRuntimeSession.count({
        where: { workspaceId: agent.workspaceId, tokenId: agent.tokenId, status: "active", expiresAt: { gt: now } }
      });
      if (active >= MAX_ACTIVE_SESSIONS_PER_TOKEN) throw new ConflictException("Лимит активных сессий токена");
      const row = await tx.agentHubRuntimeSession.create({
        data: {
          id: input.sessionId, workspaceId: agent.workspaceId, tokenId: agent.tokenId,
          kind: input.kind, capabilities: input.capabilities, status: "active",
          revision: 0, startedAt: now, lastHeartbeatAt: now,
          expiresAt: new Date(now.getTime() + PRESENCE_TTL_MS)
        }
      });
      return dto(row, now.getTime());
    });
  }

  private async mutate(agent: AgentContext, id: string, expectedRevision: number, closing: boolean): Promise<AgentHubRuntimeSession> {
    await this.checkAgent(agent);
    return this.prisma.withUser(agent.userId, async tx => {
      await this.workspaces.assertMemberTx(tx, agent.userId, agent.workspaceId);
      const now = new Date();
      const row = await tx.agentHubRuntimeSession.findFirst({
        where: { id, workspaceId: agent.workspaceId, tokenId: agent.tokenId }
      });
      if (!row) throw new NotFoundException("Сессия runtime не найдена");
      if (row.revision !== expectedRevision || row.status !== "active" || row.expiresAt <= now) {
        throw new ConflictException("Сессия неактивна или ревизия устарела");
      }
      const result = await tx.agentHubRuntimeSession.updateMany({
        where: { id, workspaceId: agent.workspaceId, tokenId: agent.tokenId, status: "active",
          revision: expectedRevision, expiresAt: { gt: now } },
        data: closing
          ? { status: "closed", revision: { increment: 1 }, closedAt: now, expiresAt: now }
          : { revision: { increment: 1 }, lastHeartbeatAt: now,
              expiresAt: new Date(now.getTime() + PRESENCE_TTL_MS) }
      });
      if (result.count !== 1) throw new ConflictException("Сессия обновилась одновременно");
      const updated = await tx.agentHubRuntimeSession.findUnique({ where: { id } });
      if (!updated) throw new NotFoundException("Сессия runtime исчезла");
      return dto(updated, now.getTime());
    });
  }

  pulse(agent: AgentContext, id: string, expectedRevision: number): Promise<AgentHubRuntimeSession> {
    return this.mutate(agent, id, expectedRevision, false);
  }

  close(agent: AgentContext, id: string, expectedRevision: number): Promise<AgentHubRuntimeSession> {
    return this.mutate(agent, id, expectedRevision, true);
  }

  async list(userId: string, workspaceId: string): Promise<AgentHubRuntimeSession[]> {
    return this.prisma.withUser(userId, async tx => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const rows = await tx.agentHubRuntimeSession.findMany({
        where: { workspaceId }, orderBy: { lastHeartbeatAt: "desc" }, take: 100
      });
      const now = Date.now();
      return rows.map(row => dto(row, now));
    });
  }
}
