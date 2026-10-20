import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AGENT_PROPOSAL_TTL_DAYS, agentProposalDiffEntrySchema, agentProposalRecordActionSchema, type AgentProposal, type AgentProposalDiffEntry } from "@orion/shared-types";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { AgentContext } from "./agent-tokens.service";

/** What a module shows about one of its records in a request: its name, and the fields an agent may change. */
export interface ModuleRecordSnapshot {
  title: string;
  /** Current values of the changeable fields (the «было» column). */
  fields: Record<string, unknown>;
  /** Human names of those fields. */
  labels: Record<string, string>;
}

/**
 * How a module changes or deletes one of its records for an agent (G13). Registered by the module's agent controller;
 * `apply` runs with the HUMAN's rights — the token owner's when a manager acts directly, the approver's on a request.
 */
export interface ModuleChangeHandler {
  /** «привычка», «контакт» — what the record is, for the request title. */
  noun: string;
  describe(userId: string, workspaceId: string, targetId: string): Promise<ModuleRecordSnapshot | null>;
  apply(userId: string, workspaceId: string, targetId: string, args: Record<string, unknown>): Promise<unknown>;
}

export type ProposalRow = Prisma.AgentProposalGetPayload<{ include: { token: { select: { name: true } } } }>;

export function proposalDto(row: ProposalRow): AgentProposal {
  return {
    id: row.id,
    tokenId: row.tokenId,
    tokenName: row.token.name,
    action: agentProposalRecordActionSchema.parse(row.action),
    targetId: row.targetId,
    targetTitle: row.targetTitle,
    reason: row.reason,
    status:
      row.status === "approved" || row.status === "rejected"
        ? row.status
        : row.expiresAt && row.expiresAt.getTime() <= Date.now()
          ? "expired"
          : "pending",
    diff: z.array(agentProposalDiffEntrySchema).catch([]).parse(row.diff ?? []),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null
  };
}

const show = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) return value.length === 0 ? null : value.map(String).join(", ");
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

/** Before/after of the fields the change touches; unchanged fields are left out. */
export function moduleChangeDiff(snapshot: ModuleRecordSnapshot, args: Record<string, unknown>): AgentProposalDiffEntry[] {
  return Object.entries(args)
    .filter(([field, after]) => after !== undefined && field in snapshot.labels && show(snapshot.fields[field]) !== show(after))
    .map(([field, after]) => ({ field, label: snapshot.labels[field]!, before: show(snapshot.fields[field]), after: show(after) }));
}

/**
 * Requests to change or delete a record of ANY module, filed by its agent tool and applied by that module's handler on
 * approval. Requests are ordinary `agent_proposals` rows (`module.update` / `module.delete`, `patch = { tool, args }`), so
 * the settings list, the chat buttons and bulk decisions treat them like task/note requests.
 */
@Injectable()
export class AgentModuleProposalsService {
  private readonly handlers = new Map<string, ModuleChangeHandler>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  register(tool: string, handler: ModuleChangeHandler): void {
    this.handlers.set(tool, handler);
  }

  handler(tool: string): ModuleChangeHandler {
    const handler = this.handlers.get(tool);
    if (!handler) throw new BadRequestException(`Инструмент «${tool}» не умеет менять записи`);
    return handler;
  }

  async snapshot(userId: string, workspaceId: string, tool: string, targetId: string): Promise<ModuleRecordSnapshot> {
    const snapshot = await this.handler(tool).describe(userId, workspaceId, targetId);
    if (!snapshot) throw new NotFoundException("Запись не найдена");
    return snapshot;
  }

  /** A pending request for this record by this token is replaced, not duplicated (the agent refined its change). */
  async file(agent: AgentContext, tool: string, op: "update" | "delete", targetId: string, args: Record<string, unknown>, reason = ""): Promise<AgentProposal> {
    const handler = this.handler(tool);
    const snapshot = await this.snapshot(agent.userId, agent.workspaceId, tool, targetId);
    const diff = op === "update" ? moduleChangeDiff(snapshot, args) : [];
    if (op === "update" && diff.length === 0) throw new BadRequestException("Предложенное изменение ничего не меняет");
    const action = op === "update" ? "module.update" : "module.delete";
    const expiresAt = new Date(Date.now() + AGENT_PROPOSAL_TTL_DAYS * 24 * 3600 * 1000);
    const data = {
      targetTitle: `${handler.noun}: ${snapshot.title}`,
      reason,
      patch: { tool, args } as Prisma.InputJsonValue,
      diff: diff as unknown as Prisma.InputJsonValue,
      expiresAt
    };
    const row = await this.prisma.withUser(agent.userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, agent.userId, agent.workspaceId);
      const existing = await tx.agentProposal.findFirst({
        where: { workspaceId: agent.workspaceId, tokenId: agent.tokenId, action, targetId, status: "pending" }
      });
      const include = { token: { select: { name: true } } } as const;
      return existing
        ? tx.agentProposal.update({ where: { id: existing.id }, data, include })
        : tx.agentProposal.create({ data: { workspaceId: agent.workspaceId, tokenId: agent.tokenId, action, targetId, ...data }, include });
    });
    return proposalDto(row);
  }

  private stored(row: ProposalRow): { tool: string; args: Record<string, unknown> } {
    const patch = (row.patch ?? {}) as { tool?: unknown; args?: unknown };
    if (typeof patch.tool !== "string") throw new BadRequestException("Запрос повреждён: не указан инструмент");
    return { tool: patch.tool, args: (patch.args && typeof patch.args === "object" ? patch.args : {}) as Record<string, unknown> };
  }

  /** On approval: the change runs once, with the approver's rights. */
  async apply(userId: string, workspaceId: string, row: ProposalRow): Promise<void> {
    const { tool, args } = this.stored(row);
    // Handlers are keyed by tool: a delete tool's `apply` deletes, an update tool's applies the change.
    await this.handler(tool).apply(userId, workspaceId, row.targetId, args);
  }

  /** «Проверить заново»: the before/after against the record as it is now. */
  async refreshDiff(userId: string, workspaceId: string, row: ProposalRow): Promise<{ title: string; diff: AgentProposalDiffEntry[] }> {
    const { tool, args } = this.stored(row);
    const handler = this.handler(tool);
    const snapshot = await this.snapshot(userId, workspaceId, tool, row.targetId);
    return { title: `${handler.noun}: ${snapshot.title}`, diff: row.action === "module.update" ? moduleChangeDiff(snapshot, args) : [] };
  }
}
