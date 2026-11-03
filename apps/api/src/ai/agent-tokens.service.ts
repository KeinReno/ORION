import { ProjectAgentReader } from "../projects/public/project-agent-reader";
import { TaskIntegrationReader } from "../tasks/public/task-integration-reader";
import { NoteAgentReferences } from "../notes/public/note-agent-references";
import { EventAgentReferences } from "../events/public/event-agent-references";
import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import type { AgentToken as TokenRow, Prisma } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import {
  AGENT_MODE_LABEL,
  AGENT_TOKEN_PREFIX,
  ASSISTANT_CHAT_TOKEN_NAME,
  type AgentPresence,
  agentAuditResultOf,
  agentForbiddenSchema,
  agentModeSchema,
  agentPermissionsSchema,
  agentScopeSchema,
  isExtensionAgentPermission,
  scopesFromPermissions,
  type AgentAuditEntry,
  type AgentAuditQuery,
  type AgentForbidden,
  type AgentMessage,
  type AgentPeer,
  type SendAgentMessageInput,
  type AgentPermissions,
  type AgentScope,
  type AgentToken,
  type CreatedAgentToken,
  type ParsedCreateAgentTokenInput,
  type UpdateAgentTokenInput
} from "@orion/shared-types";
import { isServerMode } from "../common/orion-mode";
import { PrismaService } from "../common/prisma.service";
import { loadNodeConfig } from "../lan/node-config";
import { NotificationCenterService } from "../notifications/notification-center.service";
import { AgentPresenceService, objectOfResource, presenceActivity } from "./agent-presence.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { AgentContext } from "./public/agent-context";
export type { AgentContext } from "./public/agent-context";

const DAY_MS = 24 * 60 * 60 * 1000;
/** `lastUsedAt` is a hint, not a log: don't write on every call. */
const LAST_USED_GRANULARITY_MS = 60_000;

/**
 * In `server` mode the bridge is opt-in (`ORION_AI_BRIDGE=1`); on a personal machine it is on.
 * ORION-12 follow-up: the owner can now override either direction from Настройки → ИИ и агенты
 * (`PATCH .../agent-connection/bridge`, persisted in `lan-node.json` — see `node-config.ts`), read
 * fresh on every call like `resolveMode()`/`resolveLoginPolicy()` so a toggle takes effect without
 * a restart. An explicit override always wins over the mode/env default, in both directions.
 */
export function aiBridgeEnabled(): boolean {
  const override = loadNodeConfig().aiBridgeOverride;
  if (override !== null) return override;
  return !isServerMode() || process.env.ORION_AI_BRIDGE === "1";
}

/**
 * ORION-12: the generic "ORION_AI_BRIDGE=1 включает" line left the owner unable to tell *why* the node
 * ended up in server mode in the first place — the single most common cause here is "Хост LAN" (ADR-0015),
 * which is the same `ORION_MODE=server` posture as a real multi-user deployment, not a copy of it. Naming
 * that cause turns a dead end into an actionable choice: turn LAN Host off, flip the Настройки toggle, or
 * accept the risk and set the env var.
 */
export function aiBridgeDisabledReason(): string | null {
  if (aiBridgeEnabled()) return null;
  if (loadNodeConfig().aiBridgeOverride === false) {
    return "Мост для агентов выключен владельцем узла в Настройках → ИИ и агенты. Включите его там же, если он нужен.";
  }
  if (process.env.ORION_LAN_HOST === "1") {
    return "Мост для агентов выключен, потому что включён режим «Хост LAN» (Настройки → Сеть) — это тот же серверный режим, доступный другим устройствам. Выключите «Хост LAN», если удалённый доступ не нужен, либо включите мост явно в Настройках → ИИ и агенты, понимая, что он станет доступен любому подключённому устройству.";
  }
  return "Мост для агентов выключен: этот узел запущен в серверном режиме (ORION_MODE=server). Включите его в Настройках → ИИ и агенты, понимая, что он станет доступен всем, кто может подключиться к серверу.";
}

/** Who may flip `aiBridgeOverride` — the node's recorded owner, or anyone while a fresh node has none yet (same rule as `LanService.isOwner`). */
export function aiBridgeOverrideEditableBy(userId: string): boolean {
  const owner = loadNodeConfig().ownerUserId;
  return !owner || owner === userId;
}

export function hashAgentSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Scopes that are not a matrix module: they ride along when a token is issued from a matrix. */
const NON_MATRIX_SCOPES: AgentScope[] = ["agents:message", "agents:delegate", "links:write"];
/** This many refused calls inside the window tell the owner something is wrong with the agent (or its rights). */
const DENIAL_SERIES = 5;
const DENIAL_WINDOW_MS = 10 * 60_000;
const HOUR_MS = 60 * 60_000;

/** What a call leaves in the journal besides method and status (TZ-03 section 3.4). */
export interface AuditMeta {
  module?: string;
  summary?: string;
  objectType?: string;
  objectId?: string;
  /** A direct write that went through: it counts against the hourly limit. */
  wrote?: boolean;
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
    private readonly workspaces: WorkspacesService,
    private readonly notifications: NotificationCenterService,
    private readonly presence: AgentPresenceService,
    private readonly projects: ProjectAgentReader,
    private readonly tasks: TaskIntegrationReader,
    private readonly notes: NoteAgentReferences,
    private readonly events: EventAgentReferences
  ) {}

  async create(userId: string, workspaceId: string, input: ParsedCreateAgentTokenInput): Promise<CreatedAgentToken> {
    if (!aiBridgeEnabled()) throw new ForbiddenException("AI Bridge выключен на этом сервере (ORION_AI_BRIDGE=1 включает)");
    const secret = `${AGENT_TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
    // With a matrix the scopes follow it (plus the non-matrix ones); with scopes alone the matrix stays null = derived.
    const scopes = input.permissions
      ? [...new Set([...scopesFromPermissions(input.permissions), ...input.scopes.filter((s) => NON_MATRIX_SCOPES.includes(s))])]
      : [...new Set(input.scopes)];
    const unknownPermission = input.modulePermissions.find((permission) => !isExtensionAgentPermission(permission));
    if (unknownPermission) throw new BadRequestException(`Разрешение «${unknownPermission}» не объявлено ни одним модулем`);
    // Restrictions and expiry are chosen by the token owner, not silently imposed by node mode.
    const forbidden = [...new Set(input.forbidden)];
    const row = await this.prisma.withUser(userId, async (tx) => {
      if (input.mode === "admin") {
        await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
      } else {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      }
      await this.assertProjectsTx(tx, workspaceId, [...input.allowedProjectIds, ...input.autoCommitProjectIds]);
      return tx.agentToken.create({
        data: {
          workspaceId,
          createdById: userId,
          name: input.name,
          tokenHash: hashAgentSecret(secret),
          prefix: secret.slice(0, AGENT_TOKEN_PREFIX.length + 4),
          scopes: [...scopes, ...new Set(input.modulePermissions)],
          mode: input.mode,
          permissions: input.permissions ?? undefined,
          allowedProjectIds: [...new Set(input.allowedProjectIds)],
          forbidden,
          writeLimitPerHour: input.writeLimitPerHour,
          autoCommitProjectIds: [...new Set(input.autoCommitProjectIds)],
          expiresAt: input.expiresInDays === null ? null : new Date(Date.now() + input.expiresInDays * DAY_MS)
        }
      });
    });
    return { ...toDto(row), secret };
  }

  /** Live policy edits may narrow issued scopes, never expand them (ADR-0007). */
  async update(userId: string, workspaceId: string, tokenId: string, input: UpdateAgentTokenInput): Promise<AgentToken> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertProjectsTx(tx, workspaceId, [...(input.allowedProjectIds ?? []), ...(input.autoCommitProjectIds ?? [])]);
      // Serialize policy edits so a concurrent save cannot restore a scope
      // removed by another save using an older ceiling.
      await tx.$queryRaw`SELECT id FROM agent_tokens WHERE id = ${tokenId}
        AND "workspaceId" = ${workspaceId} AND "createdById" = ${userId}
        AND "revokedAt" IS NULL FOR UPDATE`;
      const before = await tx.agentToken.findFirst({ where: { id: tokenId, workspaceId, createdById: userId, revokedAt: null } });
      if (!before) throw new NotFoundException("Токен не найден");
      // Only the workspace owner may grant, retain or modify unrestricted admin credentials.
      if (input.mode === "admin" || before.mode === "admin") {
        await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
      }
      const data: Prisma.AgentTokenUpdateManyMutationInput = {};
      if (input.mode !== undefined) data.mode = input.mode;
      if (input.permissions !== undefined) data.permissions = input.permissions;
      if (input.permissions !== undefined || input.scopes !== undefined || input.modulePermissions !== undefined) {
        const modules = input.modulePermissions ?? before.scopes.filter(isExtensionAgentPermission);
        const unknown = modules.find((permission) => !isExtensionAgentPermission(permission));
        if (unknown) throw new BadRequestException(`Разрешение «${unknown}» не объявлено ни одним модулем`);
        data.scopes = scopesAfterPolicyEdit(before.scopes, {
          permissions: input.permissions,
          extraScopes: input.scopes,
          modulePermissions: input.modulePermissions
        });
      }
      if (input.allowedProjectIds !== undefined) data.allowedProjectIds = [...new Set(input.allowedProjectIds)];
      if (input.forbidden !== undefined) data.forbidden = [...new Set(input.forbidden)];
      if (input.writeLimitPerHour !== undefined) data.writeLimitPerHour = input.writeLimitPerHour;
      if (input.autoCommitProjectIds !== undefined) data.autoCommitProjectIds = [...new Set(input.autoCommitProjectIds)];
      if (input.expiresInDays !== undefined) {
        data.expiresAt = input.expiresInDays === null ? null : new Date(Date.now() + input.expiresInDays * DAY_MS);
      }
      const result = await tx.agentToken.updateMany({ where: { id: tokenId, workspaceId, createdById: userId, revokedAt: null }, data });
      if (result.count === 0) throw new NotFoundException("Токен не найден");
      const after = await tx.agentToken.findUniqueOrThrow({ where: { id: tokenId } });
      // ORION-13: changing a token's own rights is a security-relevant event in its own right,
      // not just something the next agent call happens to reflect — the journal is where the owner
      // would look to answer "when did this token stop being read-only", so it belongs there too.
      await tx.agentAuditEntry.create({
        data: {
          workspaceId,
          tokenId: after.id,
          tokenName: after.name,
          action: "policy.update",
          resource: null,
          status: 200,
          module: null,
          summary: describePolicyChange(before, after),
          wrote: false
        }
      });
      return after;
    });
    return toDto(row);
  }

  /** A project id in a token's fence must be a project of THIS workspace, or the fence would silently match nothing. */
  private async assertProjectsTx(tx: Prisma.TransactionClient, workspaceId: string, ids: string[]): Promise<void> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const found = await this.projects.countTx(tx, workspaceId, unique);
    if (found !== unique.length) throw new BadRequestException("Проект не найден в этом пространстве");
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

  /** Every live token of the caller at once: the panic button. Returns how many were revoked. */
  async revokeAll(userId: string, workspaceId: string): Promise<number> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const result = await tx.agentToken.updateMany({
        where: { workspaceId, createdById: userId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      return result.count;
    });
  }

  async audit(userId: string, workspaceId: string, query: AgentAuditQuery = {}): Promise<AgentAuditEntry[]> {
    const where: Prisma.AgentAuditEntryWhereInput = { workspaceId };
    if (query.tokenId) where.tokenId = query.tokenId;
    if (query.module) where.module = query.module;
    if (query.from || query.to) {
      where.createdAt = { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lt: new Date(query.to) } : {}) };
    }
    if (query.result) where.status = statusFilter(query.result);
    const rows = await this.prisma.withUser(userId, async (tx) => {
      const membership = await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead", "member"]);
      // ТЗ-05: журнал чужих агентов виден владельцу пространства; остальные видят только действия своих токенов.
      if (membership.role !== "owner") {
        const own = await tx.agentToken.findMany({ where: { workspaceId, createdById: userId }, select: { id: true } });
        where.tokenId = query.tokenId && own.some((t) => t.id === query.tokenId) ? query.tokenId : { in: own.map((t) => t.id) };
      }
      return tx.agentAuditEntry.findMany({ where, orderBy: { createdAt: "desc" }, take: query.limit ?? 200 });
    });
    return rows.map(auditDto);
  }

  /** Resolve a presented secret. `null` for anything unknown, revoked or expired — no reason is leaked. */
  async authenticate(secret: string): Promise<AgentContext | null> {
    if (!aiBridgeEnabled() || !secret.startsWith(AGENT_TOKEN_PREFIX)) return null;
    const hash = hashAgentSecret(secret);
    // No user yet, so no RLS context: this lookup is the one place that is allowed to bypass it.
    const row = await this.prisma.asSystem((tx) => tx.agentToken.findUnique({ where: { tokenHash: hash } }));
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) return null;
    // ТЗ-05: токен — это права его владельца в этом пространстве; вышел/удалён из пространства — токен мёртв.
    const stillMember = await this.prisma.asSystem((tx) =>
      tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: row.workspaceId, userId: row.createdById } }, select: { id: true, role: true } })
    );
    if (!stillMember || (row.mode === "admin" && stillMember.role !== "owner")) return null;
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_GRANULARITY_MS) {
      await this.prisma.asSystem((tx) => tx.agentToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }));
    }
    // First ever use: tell the owner a new token is live. The dedup key makes a concurrent second call a no-op.
    if (!row.lastUsedAt) {
      await this.notifyOwner(row.workspaceId, row.createdById, `agent_first_use:${row.id}`, "Новый ИИ-агент подключился", `Токен «${row.name}» использован впервые.`);
    }
    return contextOf(row);
  }

  /** Throws 429 when the token already made its hourly quota of direct writes. A soft limit: concurrent calls may overshoot by a few. */
  async assertWriteBudget(agent: AgentContext): Promise<void> {
    if (agent.writeLimitPerHour === null) return;
    const used = await this.prisma.withUser(agent.userId, (tx) =>
      tx.agentAuditEntry.count({ where: { tokenId: agent.tokenId, wrote: true, createdAt: { gte: new Date(Date.now() - HOUR_MS) } } })
    );
    if (used >= agent.writeLimitPerHour) {
      throw new HttpException(`Лимит записей исчерпан: ${agent.writeLimitPerHour} в час`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** The token's project fence: `true` when there is no fence or `projectId` is inside it. */
  projectAllowed(agent: AgentContext, projectId: string | null | undefined): boolean {
    return agent.allowedProjectIds.length === 0 || (projectId != null && agent.allowedProjectIds.includes(projectId));
  }

  /** The project of an existing object (`null` = none), read under the token owner's RLS. Unknown id → 404. */
  async targetProjectId(agent: AgentContext, kind: "task" | "note" | "event", id: string): Promise<string | null> {
    return this.prisma.withUser(agent.userId, async (tx) => {
      const row = kind === "task"
        ? await this.tasks.referenceTx(tx, agent.workspaceId, id)
        : kind === "note"
          ? await this.notes.referenceTx(tx, agent.workspaceId, id)
          : await this.events.referenceTx(tx, agent.workspaceId, id);
      if (!row) throw new NotFoundException("Объект не найден");
      return row.projectId;
    });
  }

  private async notifyOwner(workspaceId: string, recipientId: string, eventKey: string, title: string, body: string): Promise<void> {
    try {
      await this.prisma.asSystem((tx) => this.notifications.createTx(tx, { workspaceId, recipientId, kind: "system", title, body, eventKey }));
    } catch {
      // A notification is a courtesy: it must never fail the agent's request.
    }
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

  /** What your agents are doing in this workspace right now (live feed, see `AgentPresenceService`). */
  async presenceFor(userId: string, workspaceId: string): Promise<AgentPresence> {
    await this.prisma.withUser(userId, (tx) => this.workspaces.assertMemberTx(tx, userId, workspaceId));
    return this.presence.recent(workspaceId, userId);
  }

  async record(agent: AgentContext, action: string, resource: string | null, status: number, meta: AuditMeta = {}): Promise<void> {
    await this.prisma.asSystem((tx) =>
      tx.agentAuditEntry.create({
        data: {
          workspaceId: agent.workspaceId,
          tokenId: agent.tokenId,
          tokenName: agent.tokenName,
          action,
          resource,
          status,
          module: meta.module ?? null,
          summary: meta.summary ?? null,
          objectType: meta.objectType ?? null,
          objectId: meta.objectId ?? null,
          wrote: meta.wrote ?? false
        }
      })
    );
    const object = meta.objectId ? { type: meta.objectType ?? "", id: meta.objectId } : objectOfResource(resource);
    this.presence.push({
      workspaceId: agent.workspaceId,
      userId: agent.userId,
      tokenId: agent.tokenId,
      agentName: agent.tokenName,
      assistant: agent.tokenName === ASSISTANT_CHAT_TOKEN_NAME,
      activity: presenceActivity(action, status, meta.wrote ?? false),
      module: meta.module ?? null,
      summary: meta.summary ?? null,
      objectType: object?.type || null,
      objectId: object?.id ?? null
    });
    if (status === 403 || status === 429) await this.checkDenialSeries(agent);
  }

  private async checkDenialSeries(agent: AgentContext): Promise<void> {
    try {
      const since = new Date(Date.now() - DENIAL_WINDOW_MS);
      const denied = await this.prisma.asSystem((tx) =>
        tx.agentAuditEntry.count({ where: { tokenId: agent.tokenId, status: { in: [403, 429] }, createdAt: { gte: since } } })
      );
      if (denied < DENIAL_SERIES) return;
      const bucket = Math.floor(Date.now() / DENIAL_WINDOW_MS);
      await this.notifyOwner(
        agent.workspaceId,
        agent.userId,
        `agent_denials:${agent.tokenId}:${bucket}`,
        "ИИ-агента много раз отклонили",
        `Токен «${agent.tokenName}»: ${denied} отказов за 10 минут. Проверьте его права и журнал.`
      );
    } catch {
      // see notifyOwner
    }
  }
}

function contextOf(row: TokenRow): AgentContext {
  return {
    tokenId: row.id,
    tokenName: row.name,
    workspaceId: row.workspaceId,
    userId: row.createdById,
    scopes: row.scopes.filter((s): s is AgentScope => agentScopeSchema.safeParse(s).success),
    modulePermissions: row.scopes.filter(isExtensionAgentPermission),
    mode: agentModeSchema.catch("assistant").parse(row.mode),
    permissions: agentPermissionsSchema.nullable().catch(null).parse(row.permissions),
    forbidden: forbiddenOf(row.forbidden),
    allowedProjectIds: row.allowedProjectIds,
    writeLimitPerHour: row.writeLimitPerHour,
    autoCommitProjectIds: row.autoCommitProjectIds
  };
}

function forbiddenOf(values: string[]): AgentForbidden[] {
  return values.filter((v): v is AgentForbidden => agentForbiddenSchema.safeParse(v).success);
}

/**
 * A live token's existing scopes remain its ceiling (ADR-0007). Omitted fields
 * are preserved; a broader matrix or module list cannot grant new scopes.
 * Issue a new token when a larger scope is required.
 */
export function scopesAfterPolicyEdit(
  previousScopes: readonly string[],
  patch: { permissions?: AgentPermissions | null; extraScopes?: readonly AgentScope[]; modulePermissions?: readonly string[] }
): string[] {
  const isExtra = (scope: string): scope is AgentScope => (NON_MATRIX_SCOPES as readonly string[]).includes(scope);
  const extras = patch.extraScopes !== undefined ? patch.extraScopes.filter(isExtra) : previousScopes.filter(isExtra);
  const modules = patch.modulePermissions !== undefined ? patch.modulePermissions : previousScopes.filter(isExtensionAgentPermission);
  const matrix = patch.permissions !== undefined
    ? scopesFromPermissions(patch.permissions ?? {})
    : previousScopes.filter((scope) => agentScopeSchema.safeParse(scope).success && !isExtra(scope));
  const ceiling = new Set(previousScopes);
  return [...new Set([...matrix, ...extras, ...modules])].filter(scope => ceiling.has(scope));
}

type PolicySnapshot = Pick<TokenRow, "mode" | "permissions" | "forbidden" | "writeLimitPerHour" | "allowedProjectIds"> & { expiresAt?: Date | null };

/** One sentence for the journal: what actually changed, not just "обновлён". Empty when nothing did (a no-op save). */
export function describePolicyChange(before: PolicySnapshot, after: PolicySnapshot): string {
  const parts: string[] = [];
  if (before.mode !== after.mode) {
    parts.push(`режим «${AGENT_MODE_LABEL[before.mode as keyof typeof AGENT_MODE_LABEL]}» → «${AGENT_MODE_LABEL[after.mode as keyof typeof AGENT_MODE_LABEL]}»`);
  }
  if (JSON.stringify(before.permissions) !== JSON.stringify(after.permissions)) parts.push("права по разделам изменены");
  if (JSON.stringify([...before.forbidden].sort()) !== JSON.stringify([...after.forbidden].sort())) parts.push("запреты изменены");
  if ((before.expiresAt?.toISOString() ?? null) !== (after.expiresAt?.toISOString() ?? null)) {
    parts.push(`срок действия: ${before.expiresAt?.toISOString() ?? "бессрочно"} → ${after.expiresAt?.toISOString() ?? "бессрочно"}`);
  }
  if (before.writeLimitPerHour !== after.writeLimitPerHour) {
    parts.push(`лимит записей: ${before.writeLimitPerHour ?? "без лимита"} → ${after.writeLimitPerHour ?? "без лимита"}`);
  }
  if (JSON.stringify([...before.allowedProjectIds].sort()) !== JSON.stringify([...after.allowedProjectIds].sort())) parts.push("набор проектов изменён");
  return parts.length > 0 ? `Права токена изменены: ${parts.join(", ")}` : "Настройки токена сохранены без изменений";
}

/** The journal's "result" filter as a status condition (`agentAuditResultOf` is its inverse). */
function statusFilter(result: NonNullable<AgentAuditQuery["result"]>): Prisma.IntFilter {
  switch (result) {
    case "ok":
      return { gte: 200, lt: 300, not: 202 };
    case "proposed":
      return { equals: 202 };
    case "denied":
      return { in: [401, 403] };
    case "limited":
      return { equals: 429 };
    case "error":
      return { gte: 300, notIn: [401, 403, 429] };
  }
}

const UNDOABLE_KINDS = ["note", "task"];

export function auditDto(r: Prisma.AgentAuditEntryGetPayload<object>): AgentAuditEntry {
  const ok = agentAuditResultOf(r.status) === "ok";
  return {
    id: r.id,
    tokenId: r.tokenId,
    tokenName: r.tokenName,
    action: r.action,
    resource: r.resource,
    status: r.status,
    module: r.module,
    summary: r.summary,
    objectType: r.objectType,
    objectId: r.objectId,
    undoable: ok && r.action.endsWith(".create") && r.objectId !== null && r.objectType !== null && UNDOABLE_KINDS.includes(r.objectType) && r.undoneAt === null,
    undoneAt: r.undoneAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString()
  };
}

function toDto(row: TokenRow): AgentToken {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes.filter((s): s is AgentScope => agentScopeSchema.safeParse(s).success),
    modulePermissions: row.scopes.filter(isExtensionAgentPermission),
    mode: agentModeSchema.catch("assistant").parse(row.mode),
    permissions: agentPermissionsSchema.nullable().catch(null).parse(row.permissions),
    allowedProjectIds: row.allowedProjectIds,
    forbidden: forbiddenOf(row.forbidden),
    writeLimitPerHour: row.writeLimitPerHour,
    autoCommitProjectIds: row.autoCommitProjectIds,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString()
  };
}
