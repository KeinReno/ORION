import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  AGENT_PROPOSAL_TTL_DAYS,
  agentEventPatchSchema,
  agentJobStatusSchema,
  agentNotePatchSchema,
  agentProposalActionSchema,
  agentProposalDiffEntrySchema,
  agentTaskPatchSchema,
  type AgentJob,
  type AgentJobStatus,
  type AgentProposal,
  type AgentProposalAction,
  type AgentProposalBulkResult,
  type CreateAgentJobInput,
  type CreateAgentProposalInput,
  type UpdateAgentJobInput
} from "@orion/shared-types";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { EventsService } from "../events/events.service";
import { NotesService } from "../notes/notes.service";
import { TasksService } from "../tasks/tasks.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { buildProposalDiff, patchFields, type DiffKind } from "./agent-diff";
import type { AgentContext } from "./agent-tokens.service";

const TERMINAL: AgentJobStatus[] = ["done", "failed", "canceled"];

/**
 * Structured jobs between agents, and destructive actions an agent may only PROPOSE.
 * Neither widens anyone's rights: a job carries text and a result, and an approved
 * proposal runs with the APPROVING HUMAN's rights, not the agent's.
 */
@Injectable()
export class AgentJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly tasks: TasksService,
    private readonly notes: NotesService,
    private readonly events: EventsService
  ) {}

  // ---------------------------------------------------------------- jobs

  async createJob(agent: AgentContext, input: CreateAgentJobInput): Promise<AgentJob> {
    if (input.toTokenId === agent.tokenId) throw new BadRequestException("Нельзя дать задание самому себе");
    const row = await this.prisma.withUser(agent.userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, agent.userId, agent.workspaceId);
      const target = await tx.agentToken.findUnique({ where: { id: input.toTokenId } });
      const alive = target && !target.revokedAt && (!target.expiresAt || target.expiresAt.getTime() > Date.now());
      if (!target || target.workspaceId !== agent.workspaceId || !alive) throw new NotFoundException("Агент не найден");
      return tx.agentTask.create({
        data: { workspaceId: agent.workspaceId, fromTokenId: agent.tokenId, toTokenId: target.id, title: input.title, body: input.body },
        include: { from: { select: { name: true } }, to: { select: { name: true } } }
      });
    });
    return jobDto(row);
  }

  /** Jobs given to or by this agent, open ones first. */
  async listJobs(agent: AgentContext): Promise<AgentJob[]> {
    const rows = await this.prisma.withUser(agent.userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, agent.userId, agent.workspaceId);
      return tx.agentTask.findMany({
        where: { workspaceId: agent.workspaceId, OR: [{ toTokenId: agent.tokenId }, { fromTokenId: agent.tokenId }] },
        include: { from: { select: { name: true } }, to: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 50
      });
    });
    const dto = rows.map(jobDto);
    return [...dto.filter((j) => !TERMINAL.includes(j.status)), ...dto.filter((j) => TERMINAL.includes(j.status))];
  }

  /** The assignee reports in_progress / done / failed; the giver may only cancel. A finished job is final. */
  async updateJob(agent: AgentContext, jobId: string, input: UpdateAgentJobInput): Promise<AgentJob> {
    const row = await this.prisma.withUser(agent.userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, agent.userId, agent.workspaceId);
      const job = await tx.agentTask.findUnique({ where: { id: jobId } });
      if (!job || job.workspaceId !== agent.workspaceId || (job.toTokenId !== agent.tokenId && job.fromTokenId !== agent.tokenId)) {
        throw new NotFoundException("Задание не найдено");
      }
      const assignee = job.toTokenId === agent.tokenId;
      if (assignee && !["in_progress", "done", "failed"].includes(input.status)) {
        throw new BadRequestException("Исполнитель может поставить in_progress, done или failed");
      }
      if (!assignee && input.status !== "canceled") throw new BadRequestException("Выдавший задание может только отменить его");
      // Atomic: the status check and the write are one statement, so two reports cannot both win.
      const claimed = await tx.agentTask.updateMany({
        where: { id: jobId, status: { notIn: TERMINAL } },
        data: { status: input.status, ...(input.result !== undefined ? { result: input.result } : {}) }
      });
      if (claimed.count === 0) throw new ConflictException("Задание уже завершено");
      return tx.agentTask.findUniqueOrThrow({
        where: { id: jobId },
        include: { from: { select: { name: true } }, to: { select: { name: true } } }
      });
    });
    return jobDto(row);
  }

  // ----------------------------------------------------------- proposals

  /**
   * Files a request. Deletions carry no patch. An `*.update` carries the change plus a before/after preview computed
   * NOW, so the human sees exactly what they approve even if the object moves on meanwhile. A second request for the
   * same object from the same token replaces the pending one (the agent refined its idea) instead of piling up.
   */
  async propose(agent: AgentContext, input: CreateAgentProposalInput): Promise<AgentProposal> {
    const patch = input.action.endsWith(".update") ? parsePatch(input.action, input.patch) : null;
    const row = await this.prisma.withUser(agent.userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, agent.userId, agent.workspaceId);
      const target = await this.loadTargetTx(tx, agent.workspaceId, input.action, input.targetId);
      const diff = patch ? buildProposalDiff(diffKind(input.action), target.current, patch) : [];
      if (patch && diff.length === 0) throw new BadRequestException("Предложенное изменение ничего не меняет");
      const expiresAt = new Date(Date.now() + AGENT_PROPOSAL_TTL_DAYS * 24 * 3600 * 1000);
      const existing = await tx.agentProposal.findFirst({
        where: { workspaceId: agent.workspaceId, tokenId: agent.tokenId, action: input.action, targetId: input.targetId, status: "pending" },
        include: { token: { select: { name: true } } }
      });
      if (existing && !patch) return existing;
      if (existing && patch) {
        return tx.agentProposal.update({
          where: { id: existing.id },
          data: { patch: patch as Prisma.InputJsonValue, diff: diff as unknown as Prisma.InputJsonValue, reason: input.reason, targetTitle: target.title, expiresAt },
          include: { token: { select: { name: true } } }
        });
      }
      return tx.agentProposal.create({
        data: {
          workspaceId: agent.workspaceId,
          tokenId: agent.tokenId,
          action: input.action,
          targetId: input.targetId,
          targetTitle: target.title,
          reason: input.reason,
          patch: patch ? (patch as Prisma.InputJsonValue) : undefined,
          diff: patch ? (diff as unknown as Prisma.InputJsonValue) : undefined,
          expiresAt
        },
        include: { token: { select: { name: true } } }
      });
    });
    return proposalDto(row);
  }

  /** What humans of the workspace still have to decide, plus the latest decisions. */
  async listProposals(userId: string, workspaceId: string): Promise<AgentProposal[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.agentProposal.findMany({
        where: { workspaceId },
        include: { token: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 100
      });
    });
    const dto = rows.map(proposalDto);
    return [...dto.filter((p) => p.status === "pending"), ...dto.filter((p) => p.status !== "pending")];
  }

  /**
   * Approve = the human does it: the change runs under THEIR rights, once. The claim is one atomic `updateMany`
   * (pending → approved, not lapsed), so two concurrent approvals cannot both run the change.
   */
  async approve(userId: string, workspaceId: string, proposalId: string): Promise<AgentProposal> {
    const claimed = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const result = await tx.agentProposal.updateMany({
        where: { id: proposalId, workspaceId, status: "pending", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        data: { status: "approved", decidedAt: new Date() }
      });
      if (result.count === 0) {
        const exists = await tx.agentProposal.findFirst({ where: { id: proposalId, workspaceId } });
        if (!exists) throw new NotFoundException("Запрос не найден");
        throw new ConflictException(exists.status === "pending" ? "Срок запроса истёк" : "Запрос уже обработан");
      }
      return tx.agentProposal.findUniqueOrThrow({ where: { id: proposalId }, include: { token: { select: { name: true } } } });
    });
    try {
      await this.execute(userId, workspaceId, claimed);
    } catch (error) {
      // Already gone is fine; anything else puts the request back so the human can retry or reject.
      if (!(error instanceof NotFoundException)) {
        await this.prisma.withUser(userId, (tx) =>
          tx.agentProposal.updateMany({ where: { id: proposalId, status: "approved" }, data: { status: "pending", decidedAt: null } })
        );
        throw error;
      }
    }
    return proposalDto(claimed);
  }

  /** Several at once; one failure does not stop the rest. */
  async decideMany(userId: string, workspaceId: string, ids: string[], decision: "approve" | "reject"): Promise<AgentProposalBulkResult> {
    // A non-member gets one clear 403 instead of a list of per-item failures.
    await this.prisma.withUser(userId, (tx) => this.workspaces.assertMemberTx(tx, userId, workspaceId));
    const results: AgentProposalBulkResult["results"] = [];
    for (const id of [...new Set(ids)]) {
      try {
        if (decision === "approve") await this.approve(userId, workspaceId, id);
        else await this.reject(userId, workspaceId, id);
        results.push({ id, ok: true, error: null });
      } catch (error) {
        results.push({ id, ok: false, error: error instanceof HttpException ? error.message : "Не удалось выполнить" });
      }
    }
    return { results };
  }

  private async execute(userId: string, workspaceId: string, row: ProposalRow): Promise<void> {
    const action = agentProposalActionSchema.parse(row.action);
    const agentName = row.token.name;
    switch (action) {
      case "task.delete":
        return this.tasks.remove(userId, workspaceId, row.targetId);
      case "note.delete":
        return this.notes.remove(userId, workspaceId, row.targetId);
      case "task.update":
        await this.tasks.update(userId, workspaceId, row.targetId, agentTaskPatchSchema.parse(row.patch ?? {}), agentName);
        return;
      case "note.update":
        await this.notes.update(userId, workspaceId, row.targetId, agentNotePatchSchema.parse(row.patch ?? {}), agentName);
        return;
      case "event.update":
        await this.events.update(userId, workspaceId, row.targetId, agentEventPatchSchema.parse(row.patch ?? {}), "all");
        return;
    }
  }

  async reject(userId: string, workspaceId: string, proposalId: string): Promise<AgentProposal> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const result = await tx.agentProposal.updateMany({
        where: { id: proposalId, workspaceId, status: "pending" },
        data: { status: "rejected", decidedAt: new Date() }
      });
      if (result.count === 0) {
        const exists = await tx.agentProposal.findFirst({ where: { id: proposalId, workspaceId } });
        throw exists ? new ConflictException("Запрос уже обработан") : new NotFoundException("Запрос не найден");
      }
      return tx.agentProposal.findUniqueOrThrow({ where: { id: proposalId }, include: { token: { select: { name: true } } } });
    });
    return proposalDto(row);
  }

  /** The object a proposal is about: its title for the human, its stored fields for the before/after preview. */
  private async loadTargetTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    action: AgentProposalAction,
    targetId: string
  ): Promise<{ title: string; current: Record<string, unknown> }> {
    if (action.startsWith("task.")) {
      const task = await tx.task.findUnique({ where: { id: targetId } });
      if (!task || task.workspaceId !== workspaceId) throw new NotFoundException("Задача не найдена");
      return { title: task.title, current: task as unknown as Record<string, unknown> };
    }
    if (action.startsWith("note.")) {
      const note = await tx.note.findUnique({ where: { id: targetId } });
      if (!note || note.workspaceId !== workspaceId || note.deletedAt) throw new NotFoundException("Заметка не найдена");
      return { title: note.title, current: note as unknown as Record<string, unknown> };
    }
    const event = await tx.event.findUnique({ where: { id: targetId } });
    if (!event || event.workspaceId !== workspaceId) throw new NotFoundException("Событие не найдено");
    if (event.readOnly) throw new BadRequestException("Внешнее событие доступно только для чтения");
    return { title: event.title, current: event as unknown as Record<string, unknown> };
  }
}

function diffKind(action: AgentProposalAction): DiffKind {
  return action.startsWith("task.") ? "task" : action.startsWith("note.") ? "note" : "event";
}

const PATCH_SCHEMAS: Record<DiffKind, z.ZodTypeAny> = { task: agentTaskPatchSchema, note: agentNotePatchSchema, event: agentEventPatchSchema };

/** Validate against the same patch an agent could send directly; `expectedRevision` is dropped (the human approves the current object). */
export function parsePatch(action: AgentProposalAction, raw: unknown): Record<string, unknown> {
  const kind = diffKind(action);
  const parsed = PATCH_SCHEMAS[kind].safeParse(raw);
  if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
  const fields = new Set(patchFields(kind));
  const patch = Object.fromEntries(Object.entries(parsed.data as Record<string, unknown>).filter(([k, v]) => fields.has(k) && v !== undefined));
  if (Object.keys(patch).length === 0) throw new BadRequestException("Пустое изменение");
  return patch;
}

type JobRow = Prisma.AgentTaskGetPayload<{ include: { from: { select: { name: true } }; to: { select: { name: true } } } }>;

function jobDto(row: JobRow): AgentJob {
  return {
    id: row.id,
    fromTokenId: row.fromTokenId,
    fromName: row.from.name,
    toTokenId: row.toTokenId,
    toName: row.to.name,
    title: row.title,
    body: row.body,
    status: agentJobStatusSchema.catch("pending").parse(row.status),
    result: row.result,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

type ProposalRow = Prisma.AgentProposalGetPayload<{ include: { token: { select: { name: true } } } }>;

function proposalDto(row: ProposalRow): AgentProposal {
  return {
    id: row.id,
    tokenId: row.tokenId,
    tokenName: row.token.name,
    action: agentProposalActionSchema.parse(row.action),
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
