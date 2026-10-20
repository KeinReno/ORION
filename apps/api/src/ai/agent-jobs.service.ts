import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  AGENT_PROPOSAL_TTL_DAYS,
  agentEventPatchSchema,
  agentJobStatusSchema,
  agentNotePatchSchema,
  agentProposalActionSchema,
  agentTaskPatchSchema,
  type AgentJob,
  type AgentJobStatus,
  type AgentProposal,
  type AgentProposalDiffEntry,
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
import { AgentModuleProposalsService, proposalDto, type ProposalRow } from "./agent-module-proposals.service";
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
    private readonly events: EventsService,
    private readonly moduleProposals: AgentModuleProposalsService
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
          data: {
            patch: patch as Prisma.InputJsonValue,
            diff: diff as unknown as Prisma.InputJsonValue,
            reason: input.reason,
            targetTitle: target.title,
            baseRevision: target.revision,
            baseUpdatedAt: target.updatedAt,
            expiresAt
          },
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
          baseRevision: target.revision,
          baseUpdatedAt: target.updatedAt,
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
  async approve(userId: string, workspaceId: string, proposalId: string, force = false): Promise<AgentProposal> {
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
      const row = await tx.agentProposal.findUniqueOrThrow({ where: { id: proposalId }, include: { token: { select: { name: true } } } });
      // Inside the same transaction as the claim: a stale object throws and the claim rolls back, the request stays pending.
      if (!force) {
        const stale = await this.staleCheckTx(tx, workspaceId, row);
        if (stale) throw staleError(proposalId, stale);
      }
      return row;
    });
    try {
      await this.execute(userId, workspaceId, claimed, force);
    } catch (error) {
      // Already gone is fine; anything else puts the request back so the human can retry or reject.
      if (!(error instanceof NotFoundException)) {
        await this.prisma.withUser(userId, (tx) =>
          tx.agentProposal.updateMany({ where: { id: proposalId, status: "approved" }, data: { status: "pending", decidedAt: null } })
        );
        // The object moved between the check and the write: the CAS in the service caught it. Report it as stale too.
        if (!force && isRevisionConflict(error)) {
          const stale = await this.prisma.withUser(userId, (tx) => this.staleCheckTx(tx, workspaceId, claimed));
          if (stale) throw staleError(proposalId, stale);
        }
        throw error;
      }
    }
    return proposalDto(claimed);
  }

  /**
   * "Проверить заново": the human saw the stale warning and wants the request judged against the object as it is now.
   * Recomputes the before/after preview and moves the basis to the current version; the request stays pending, so the
   * next plain approval applies exactly what the refreshed preview shows.
   */
  async refresh(userId: string, workspaceId: string, proposalId: string): Promise<AgentProposal> {
    const updated = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const current = await tx.agentProposal.findFirst({
        where: { id: proposalId, workspaceId, status: "pending", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }
      });
      if (!current) throw new NotFoundException("Запрос не найден или уже обработан");
      if (current.action.startsWith("module.")) return null;
      const action = agentProposalActionSchema.parse(current.action);
      const target = await this.findTargetTx(tx, workspaceId, action, current.targetId);
      if (!target) throw new ConflictException("Объект уже удалён — запрос можно только отклонить");
      const diff = current.patch ? buildProposalDiff(diffKind(action), target.current, current.patch as Record<string, unknown>) : [];
      return tx.agentProposal.update({
        where: { id: proposalId },
        data: { diff: diff as unknown as Prisma.InputJsonValue, targetTitle: target.title, baseRevision: target.revision, baseUpdatedAt: target.updatedAt },
        include: { token: { select: { name: true } } }
      });
    });
    // A module's record is described by its own handler, outside this transaction.
    const row =
      updated ??
      (await (async () => {
        const current = await this.prisma.withUser(userId, (tx) =>
          tx.agentProposal.findFirstOrThrow({ where: { id: proposalId, workspaceId }, include: { token: { select: { name: true } } } })
        );
        const fresh = await this.moduleProposals.refreshDiff(userId, workspaceId, current);
        return this.prisma.withUser(userId, (tx) =>
          tx.agentProposal.update({
            where: { id: proposalId },
            data: { diff: fresh.diff as unknown as Prisma.InputJsonValue, targetTitle: fresh.title },
            include: { token: { select: { name: true } } }
          })
        );
      })());
    return proposalDto(row);
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

  private async execute(userId: string, workspaceId: string, row: ProposalRow, force: boolean): Promise<void> {
    if (row.action === "module.update" || row.action === "module.delete") return this.moduleProposals.apply(userId, workspaceId, row);
    const action = agentProposalActionSchema.parse(row.action);
    const agentName = row.token.name;
    switch (action) {
      case "task.delete":
        return this.tasks.remove(userId, workspaceId, row.targetId);
      case "note.delete":
        return this.notes.remove(userId, workspaceId, row.targetId);
      case "event.delete":
        // The whole event (every occurrence of a series): the request named the event, not one date.
        return this.events.remove(userId, workspaceId, row.targetId, "all");
      case "task.update":
        await this.tasks.update(userId, workspaceId, row.targetId, agentTaskPatchSchema.parse({ ...((row.patch ?? {}) as object), ...casOf(row, force) }), agentName);
        return;
      case "note.update":
        await this.notes.update(userId, workspaceId, row.targetId, agentNotePatchSchema.parse({ ...((row.patch ?? {}) as object), ...casOf(row, force) }), agentName);
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
  private async loadTargetTx(tx: Prisma.TransactionClient, workspaceId: string, action: AgentProposalAction, targetId: string): Promise<TargetSnapshot> {
    const found = await this.findTargetTx(tx, workspaceId, action, targetId);
    if (!found) {
      throw new NotFoundException(action.startsWith("task.") ? "Задача не найдена" : action.startsWith("note.") ? "Заметка не найдена" : "Событие не найдено");
    }
    if (found.readOnly) throw new BadRequestException("Внешнее событие доступно только для чтения");
    return found;
  }

  /** Same lookup without throwing: `null` = the object is gone (deleted, in the trash, other workspace). */
  private async findTargetTx(tx: Prisma.TransactionClient, workspaceId: string, action: AgentProposalAction, targetId: string): Promise<(TargetSnapshot & { readOnly: boolean }) | null> {
    if (action.startsWith("task.")) {
      const task = await tx.task.findUnique({ where: { id: targetId } });
      if (!task || task.workspaceId !== workspaceId) return null;
      return { title: task.title, current: task as unknown as Record<string, unknown>, revision: task.revision, updatedAt: task.updatedAt, readOnly: false };
    }
    if (action.startsWith("note.")) {
      const note = await tx.note.findUnique({ where: { id: targetId } });
      if (!note || note.workspaceId !== workspaceId || note.deletedAt) return null;
      return { title: note.title, current: note as unknown as Record<string, unknown>, revision: note.revision, updatedAt: note.updatedAt, readOnly: false };
    }
    const event = await tx.event.findUnique({ where: { id: targetId } });
    if (!event || event.workspaceId !== workspaceId) return null;
    return { title: event.title, current: event as unknown as Record<string, unknown>, revision: null, updatedAt: event.updatedAt, readOnly: event.readOnly };
  }

  /**
   * "The object changed after the request": what the proposal was filed against (`baseRevision` for tasks/notes,
   * `baseUpdatedAt` for events) versus the object now. Legacy rows without a basis are never stale. A vanished
   * object is not stale either — executing reports it (404) as before.
   */
  private async staleCheckTx(tx: Prisma.TransactionClient, workspaceId: string, row: ProposalRow): Promise<StaleInfo | null> {
    // Module requests carry no CAS basis: approving applies the requested fields to the record as it is.
    if (row.action.startsWith("module.")) return null;
    const action = agentProposalActionSchema.parse(row.action);
    const target = await this.findTargetTx(tx, workspaceId, action, row.targetId);
    if (!target) return null;
    const changed =
      row.baseRevision !== null
        ? target.revision !== row.baseRevision
        : row.baseUpdatedAt !== null && target.updatedAt.getTime() !== row.baseUpdatedAt.getTime();
    if (!changed) return null;
    const patch = action.endsWith(".update") ? ((row.patch ?? {}) as Record<string, unknown>) : null;
    return { target, currentDiff: patch ? buildProposalDiff(diffKind(action), target.current, patch) : [] };
  }
}

/** Unless the human chose to apply anyway, the write itself checks the basis (atomic CAS for tasks/notes). */
function casOf(row: ProposalRow, force: boolean): { expectedRevision?: number } {
  return !force && row.baseRevision !== null ? { expectedRevision: row.baseRevision } : {};
}

function isRevisionConflict(error: unknown): boolean {
  if (!(error instanceof ConflictException)) return false;
  const body = error.getResponse();
  return typeof body === "object" && body !== null && ["task_revision_conflict", "note_revision_conflict"].includes((body as { code?: string }).code ?? "");
}

function staleError(proposalId: string, stale: StaleInfo): ConflictException {
  return new ConflictException({
    code: "agent_proposal_stale",
    message: "Объект изменился после запроса агента. Проверьте изменение заново на текущей версии или подтвердите явно.",
    proposalId,
    currentDiff: stale.currentDiff
  });
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

interface TargetSnapshot {
  title: string;
  current: Record<string, unknown>;
  /** Task/note CAS counter; events have none (`null`). */
  revision: number | null;
  updatedAt: Date;
}
interface StaleInfo {
  target: TargetSnapshot;
  currentDiff: AgentProposalDiffEntry[];
}

