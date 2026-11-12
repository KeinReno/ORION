import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type AgentMemoryRecord as MemoryRow } from "@prisma/client";
import {
  AGENT_TOOLS,
  MODULE_CATALOG,
  decideAgentModuleOperation,
  type AgentHubContextEntry,
  type AgentHubContextInput,
  type AgentHubContextQuery,
  type AgentHubContextResponse,
  type AgentMemoryReadQuery,
  type AgentMemoryRecord,
  type AgentMemoryScope,
  type AgentMemoryValidityInput,
  type AgentMemoryWriteInput,
  type OrionModuleId
} from "@orion/shared-types";
import type { AgentContext } from "../../ai/public/agent-context";
import { PrismaService } from "../../common/prisma.service";
import { ModulesService } from "../../modules/modules.service";
import { ProjectReferences } from "../../projects/public/project-references";
import { TaskIntegrationReader } from "../../tasks/public/task-integration-reader";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { AgentHubTransitions } from "./agent-hub-transitions.service";

const MAX_CONTEXT_BYTES = 32 * 1024;
const MAX_CONTEXT_RECORDS = 50;
const MAX_VALUE_BYTES = 64 * 1024;

type Viewer = {
  userId: string;
  /** Agent profile bound to the caller's credential; null for a human. */
  profileId: string | null;
  agent: AgentContext | null;
  allowedProjectIds: string[];
};

type ConfirmedScope = { scope: AgentMemoryScope; scopeId: string | null };

/**
 * Agent memory and pre-run context (task 09.3).
 *
 * Memory is scoped knowledge with a revision chain: a rewrite creates a new
 * `valid` row and marks the previous one `superseded`, so history is never lost.
 * User memory written by an agent is private to that agent profile of that user;
 * another agent gets 403, not a filtered list.
 */
@Injectable()
export class AgentHubMemoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService,
    private readonly tasks: TaskIntegrationReader,
    private readonly projects: ProjectReferences,
    private readonly transitions: AgentHubTransitions
  ) {}

  private recordDto(row: MemoryRow): AgentMemoryRecord {
    return {
      id: row.id, workspaceId: row.workspaceId,
      scope: row.scope as AgentMemoryScope, scopeId: row.scopeId,
      key: row.key, value: row.value,
      source: row.source as AgentMemoryRecord["source"],
      agentId: row.agentId, provenanceEventId: row.provenanceEventId,
      validity: row.validity as AgentMemoryRecord["validity"],
      supersededById: row.supersededById,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString()
    };
  }

  private async viewerForAgentTx(tx: Prisma.TransactionClient, agent: AgentContext): Promise<Viewer> {
    return {
      userId: agent.userId,
      profileId: await this.transitions.profileIdForTokenTx(tx, agent.workspaceId, agent.tokenId),
      agent,
      allowedProjectIds: agent.allowedProjectIds
    };
  }

  private userViewer(userId: string): Viewer {
    return { userId, profileId: null, agent: null, allowedProjectIds: [] };
  }

  private async assertProjectTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string): Promise<void> {
    if (!await this.projects.existsTx(tx, workspaceId, projectId)) throw new NotFoundException("Проект памяти не найден");
  }

  private async assertOwnedProfileTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, profileId: string): Promise<void> {
    const profile = await tx.agentHubAgentProfile.findFirst({
      where: { id: profileId, workspaceId, createdById: userId }, select: { id: true }
    });
    if (!profile) throw new ForbiddenException("Память другого агента недоступна");
  }

  /** Scope is normalised from who writes: a user/agent scope id can never be forged. */
  private async confirmedScopeTx(
    tx: Prisma.TransactionClient, workspaceId: string, viewer: Viewer, scope: AgentMemoryScope, scopeId: string | undefined
  ): Promise<ConfirmedScope> {
    if (scope === "global") {
      if (scopeId) throw new ForbiddenException("У общей памяти нет scopeId");
      return { scope, scopeId: null };
    }
    if (scope === "user") {
      if (scopeId && scopeId !== viewer.userId) throw new ForbiddenException("Пользовательская память другого пользователя недоступна");
      return { scope, scopeId: viewer.userId };
    }
    if (scope === "agent") {
      if (viewer.profileId) {
        if (scopeId && scopeId !== viewer.profileId) throw new ForbiddenException("Память другого агента недоступна");
        return { scope, scopeId: viewer.profileId };
      }
      if (!scopeId) throw new ForbiddenException("Укажите agentId для памяти агента");
      await this.assertOwnedProfileTx(tx, viewer.userId, workspaceId, scopeId);
      return { scope, scopeId };
    }
    if (!scopeId) throw new ForbiddenException("Укажите projectId для памяти проекта");
    await this.assertProjectTx(tx, workspaceId, scopeId);
    if (viewer.agent && viewer.allowedProjectIds.length > 0 && !viewer.allowedProjectIds.includes(scopeId)) {
      throw new ForbiddenException("Память проекта вне разрешённых проектов токена");
    }
    return { scope, scopeId };
  }

  /** Read visibility is checked per row, so no scope can leak through a broad filter. */
  private readable(row: MemoryRow, viewer: Viewer): boolean {
    if (row.scope === "global") return true;
    if (row.scope === "project") {
      if (!viewer.agent) return true;
      return viewer.allowedProjectIds.length === 0 || (row.scopeId !== null && viewer.allowedProjectIds.includes(row.scopeId));
    }
    if (row.scope === "user") {
      if (row.scopeId !== viewer.userId) return false;
      if (!viewer.agent) return true;
      return row.agentId === null || row.agentId === viewer.profileId;
    }
    if (row.scope === "agent") return viewer.profileId !== null && row.scopeId === viewer.profileId;
    return false;
  }

  /** Human readers may inspect agent memory of profiles they own. */
  private async readableAgentScopesTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string): Promise<Set<string>> {
    const rows = await tx.agentHubAgentProfile.findMany({
      where: { workspaceId, createdById: userId }, select: { id: true }
    });
    return new Set(rows.map(row => row.id));
  }

  private assertValueSize(value: unknown): Prisma.InputJsonValue {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new ForbiddenException("Значение памяти должно быть JSON");
    if (Buffer.byteLength(encoded, "utf8") > MAX_VALUE_BYTES) throw new ForbiddenException("Значение памяти больше 64 КБ");
    return value as Prisma.InputJsonValue;
  }

  private async writeTx(
    tx: Prisma.TransactionClient, workspaceId: string, viewer: Viewer, input: AgentMemoryWriteInput, source: "agent" | "user"
  ): Promise<AgentMemoryRecord> {
    await this.workspaces.assertMemberTx(tx, viewer.userId, workspaceId);
    await this.modules.assertEnabledTx(tx, viewer.userId, workspaceId, "agent-hub");
    const confirmed = await this.confirmedScopeTx(tx, workspaceId, viewer, input.scope, input.scopeId);
    const value = this.assertValueSize(input.value);
    // User memory written by an agent is private to that profile: another agent may
    // not take over its key, even inside the same human workspace account.
    if (viewer.agent && confirmed.scope === "user") {
      const foreign = await tx.agentMemoryRecord.findFirst({
        where: {
          workspaceId, scope: "user", scopeId: confirmed.scopeId, key: input.key,
          agentId: { not: viewer.profileId }
        },
        select: { id: true }
      });
      if (foreign) throw new ForbiddenException("Память другого агента недоступна");
    }
    const existing = await tx.agentMemoryRecord.findFirst({
      where: {
        workspaceId, scope: confirmed.scope, scopeId: confirmed.scopeId, key: input.key,
        agentId: viewer.profileId, validity: "valid"
      },
      orderBy: { updatedAt: "desc" }, select: { id: true }
    });
    // Insert as `outdated` first: the partial unique index allows exactly one valid row per key.
    const created = await tx.agentMemoryRecord.create({
      data: {
        workspaceId, scope: confirmed.scope, scopeId: confirmed.scopeId, key: input.key,
        value, source, agentId: viewer.profileId, userId: viewer.userId,
        provenanceEventId: input.provenanceEventId ?? null,
        validity: existing ? "outdated" : "valid", createdById: viewer.userId
      }
    });
    if (existing) {
      await tx.agentMemoryRecord.update({
        where: { id: existing.id },
        data: { validity: "superseded", supersededById: created.id }
      });
      const updated = await tx.agentMemoryRecord.update({ where: { id: created.id }, data: { validity: "valid" } });
      return this.recordDto(updated);
    }
    return this.recordDto(created);
  }

  async writeAsAgent(agent: AgentContext, input: AgentMemoryWriteInput): Promise<AgentMemoryRecord> {
    return this.prisma.withUser(agent.userId, async tx => {
      const viewer = await this.viewerForAgentTx(tx, agent);
      return this.writeTx(tx, agent.workspaceId, viewer, input, "agent");
    });
  }

  async writeAsUser(userId: string, workspaceId: string, input: AgentMemoryWriteInput): Promise<AgentMemoryRecord> {
    return this.prisma.withUser(userId, async tx =>
      this.writeTx(tx, workspaceId, this.userViewer(userId), input, "user"));
  }

  private async listTx(
    tx: Prisma.TransactionClient, workspaceId: string, viewer: Viewer, query: AgentMemoryReadQuery
  ): Promise<AgentMemoryRecord[]> {
    await this.workspaces.assertMemberTx(tx, viewer.userId, workspaceId);
    await this.modules.assertEnabledTx(tx, viewer.userId, workspaceId, "agent-hub");
    const where: Prisma.AgentMemoryRecordWhereInput = {
      workspaceId,
      validity: query.includeHistory ? undefined : { in: ["valid", "outdated"] }
    };
    if (query.scope) where.scope = query.scope;
    if (query.scopeId) where.scopeId = query.scopeId;
    if (query.key) where.key = query.key;
    const rows = await tx.agentMemoryRecord.findMany({
      where, orderBy: [{ updatedAt: "desc" }], take: query.limit
    });
    const ownedAgentProfiles = viewer.agent ? null : await this.readableAgentScopesTx(tx, viewer.userId, workspaceId);
    return rows.filter(row => {
      if (row.scope === "agent" && ownedAgentProfiles) return row.scopeId !== null && ownedAgentProfiles.has(row.scopeId);
      return this.readable(row, viewer);
    }).map(row => this.recordDto(row));
  }

  listAsAgent(agent: AgentContext, query: AgentMemoryReadQuery): Promise<AgentMemoryRecord[]> {
    return this.prisma.withUser(agent.userId, async tx => {
      const viewer = await this.viewerForAgentTx(tx, agent);
      return this.listTx(tx, agent.workspaceId, viewer, query);
    });
  }

  listAsUser(userId: string, workspaceId: string, query: AgentMemoryReadQuery): Promise<AgentMemoryRecord[]> {
    return this.prisma.withUser(userId, async tx =>
      this.listTx(tx, workspaceId, this.userViewer(userId), query));
  }

  /** Human correction: a record can be marked outdated and later trusted again; superseded is final. */
  async setValidity(userId: string, workspaceId: string, id: string, input: AgentMemoryValidityInput): Promise<AgentMemoryRecord> {
    try {
      return await this.prisma.withUser(userId, async tx => {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
        await this.modules.assertEnabledTx(tx, userId, workspaceId, "agent-hub");
        const row = await tx.agentMemoryRecord.findFirst({ where: { id, workspaceId } });
        if (!row) throw new NotFoundException("Запись памяти не найдена");
        if (row.validity === "superseded") throw new ConflictException("Замещённая запись памяти неизменяема");
        const viewer = this.userViewer(userId);
        if (row.scope === "agent") await this.assertOwnedProfileTx(tx, userId, workspaceId, row.scopeId ?? "");
        else if (!this.readable(row, viewer) && row.scope !== "project") throw new ForbiddenException("Запись памяти недоступна");
        const updated = await tx.agentMemoryRecord.update({ where: { id }, data: { validity: input.validity } });
        return this.recordDto(updated);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("У этого ключа уже есть действующая запись");
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------- context

  private async resolveScopesTx(
    tx: Prisma.TransactionClient, workspaceId: string, viewer: Viewer, input: AgentHubContextInput | AgentHubContextQuery
  ): Promise<{ scopes: ConfirmedScope[]; projectId: string | null; agentId: string | null }> {
    let projectId = input.projectId ?? null;
    let agentId = input.agentId ?? null;
    if (input.executionId) {
      const row = await this.transitions.loadTx(tx, workspaceId, input.executionId);
      if (viewer.agent) await this.transitions.accessibleTx(tx, viewer.agent, row);
      const task = await this.transitions.governingTaskTx(tx, row);
      projectId ??= task?.projectId ?? null;
      if (!agentId) {
        agentId = row.delegatedToProfileId
          ?? (row.workerId ? await this.transitions.profileIdForTokenTx(tx, workspaceId, row.workerId) : null);
      }
    }
    if (!projectId && input.taskId) {
      const task = await this.tasks.referenceTx(tx, workspaceId, input.taskId);
      if (!task) throw new NotFoundException("Задача контекста не найдена");
      projectId = task.projectId;
    }
    const scopes: ConfirmedScope[] = [{ scope: "global", scopeId: null }];
    if (projectId) {
      await this.assertProjectTx(tx, workspaceId, projectId);
      if (viewer.agent && viewer.allowedProjectIds.length > 0 && !viewer.allowedProjectIds.includes(projectId)) {
        throw new ForbiddenException("Контекст проекта вне разрешённых проектов токена");
      }
      scopes.push({ scope: "project", scopeId: projectId });
    }
    if (agentId) {
      if (viewer.agent) {
        if (agentId !== viewer.profileId) throw new ForbiddenException("Контекст другого агента недоступен");
      } else {
        await this.assertOwnedProfileTx(tx, viewer.userId, workspaceId, agentId);
      }
      scopes.push({ scope: "agent", scopeId: agentId });
    }
    scopes.push({ scope: "user", scopeId: viewer.userId });
    return { scopes, projectId, agentId };
  }

  private async capabilitiesForTx(
    tx: Prisma.TransactionClient, workspaceId: string, viewer: Viewer
  ): Promise<AgentHubContextResponse["capabilities"]> {
    const enabled = await this.modules.accessibleSetTx(tx, viewer.userId, workspaceId);
    const groups = new Map<string, { moduleId: string; label: string; tools: Array<{ name: string; description: string; effect: string }> }>();
    for (const tool of AGENT_TOOLS) {
      if (!tool.moduleId || !tool.permission || !enabled.has(tool.moduleId as OrionModuleId)) continue;
      if (viewer.agent) {
        const op = tool.effect === "read" ? "read"
          : tool.effect === "create" ? "create"
            : tool.effect === "update" ? "update"
              : tool.effect === "delete" || tool.effect === "delete_request" ? "delete" : null;
        if (!op || decideAgentModuleOperation(viewer.agent, tool.permission, op).kind !== "allow") continue;
      }
      const group = groups.get(tool.moduleId)
        ?? { moduleId: tool.moduleId, label: MODULE_CATALOG.find(item => item.id === tool.moduleId)?.label ?? tool.moduleId, tools: [] };
      group.tools.push({ name: tool.name, description: tool.description, effect: tool.effect });
      groups.set(tool.moduleId, group);
    }
    return [...groups.values()].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }

  private async contextTx(
    tx: Prisma.TransactionClient, workspaceId: string, viewer: Viewer, input: AgentHubContextInput | AgentHubContextQuery
  ): Promise<AgentHubContextResponse> {
    await this.workspaces.assertMemberTx(tx, viewer.userId, workspaceId);
    await this.modules.assertEnabledTx(tx, viewer.userId, workspaceId, "agent-hub");
    const { scopes } = await this.resolveScopesTx(tx, workspaceId, viewer, input);
    const rows = await tx.agentMemoryRecord.findMany({
      where: {
        workspaceId,
        validity: { in: ["valid", "outdated"] },
        OR: scopes.map(item => ({ scope: item.scope, scopeId: item.scopeId }))
      },
      orderBy: [{ updatedAt: "desc" }], take: 500
    });
    const ownedAgentProfiles = viewer.agent ? null : await this.readableAgentScopesTx(tx, viewer.userId, workspaceId);
    const visible = rows.filter(row => {
      if (row.scope === "agent" && ownedAgentProfiles) return row.scopeId !== null && ownedAgentProfiles.has(row.scopeId);
      return this.readable(row, viewer);
    });
    visible.sort((a, b) => (a.validity === b.validity ? b.updatedAt.getTime() - a.updatedAt.getTime() : a.validity === "valid" ? -1 : 1));

    const maxRecords = Math.min(input.limit ?? MAX_CONTEXT_RECORDS, MAX_CONTEXT_RECORDS);
    const memory: AgentHubContextEntry[] = [];
    let bytes = 0;
    for (const row of visible) {
      if (memory.length >= maxRecords) break;
      const size = Buffer.byteLength(JSON.stringify(row.value ?? null) + row.key, "utf8");
      if (bytes + size > MAX_CONTEXT_BYTES) break;
      bytes += size;
      memory.push({
        id: row.id, scope: row.scope as AgentMemoryScope, scopeId: row.scopeId,
        key: row.key, value: row.value, source: row.source as AgentMemoryRecord["source"],
        validity: row.validity as AgentMemoryRecord["validity"],
        needsVerification: row.validity === "outdated",
        updatedAt: row.updatedAt.toISOString()
      });
    }
    const outdated = visible.filter(row => row.validity === "outdated").length;
    const superseded = await tx.agentMemoryRecord.count({
      where: {
        workspaceId, validity: "superseded",
        OR: scopes.map(item => ({ scope: item.scope, scopeId: item.scopeId }))
      }
    });
    const warnings: string[] = [];
    if (outdated > 0) warnings.push(`${outdated} записей памяти устарели — перепроверьте их перед использованием`);
    if (superseded > 0) warnings.push(`${superseded} записей памяти замещены более новыми ревизиями; история доступна отдельно`);
    const capabilities = input.includeCapabilities === false
      ? []
      : await this.capabilitiesForTx(tx, workspaceId, viewer);
    return {
      scopes, memory, capabilities,
      limits: { maxRecords, maxBytes: MAX_CONTEXT_BYTES },
      truncated: visible.length > memory.length,
      warnings
    };
  }

  contextForAgent(agent: AgentContext, query: AgentHubContextQuery): Promise<AgentHubContextResponse> {
    return this.prisma.withUser(agent.userId, async tx => {
      const viewer = await this.viewerForAgentTx(tx, agent);
      return this.contextTx(tx, agent.workspaceId, viewer, query);
    });
  }

  contextForUser(userId: string, workspaceId: string, input: AgentHubContextInput): Promise<AgentHubContextResponse> {
    return this.prisma.withUser(userId, async tx =>
      this.contextTx(tx, workspaceId, this.userViewer(userId), input));
  }
}
