import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  agentJobStatusSchema,
  agentProposalActionSchema,
  type AgentJob,
  type AgentJobStatus,
  type AgentProposal,
  type CreateAgentJobInput,
  type CreateAgentProposalInput,
  type UpdateAgentJobInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { NotesService } from "../notes/notes.service";
import { TasksService } from "../tasks/tasks.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
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
    private readonly notes: NotesService
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

  async propose(agent: AgentContext, input: CreateAgentProposalInput): Promise<AgentProposal> {
    const row = await this.prisma.withUser(agent.userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, agent.userId, agent.workspaceId);
      const title = await this.targetTitleTx(tx, agent.workspaceId, input.action, input.targetId);
      const existing = await tx.agentProposal.findFirst({
        where: { workspaceId: agent.workspaceId, tokenId: agent.tokenId, action: input.action, targetId: input.targetId, status: "pending" },
        include: { token: { select: { name: true } } }
      });
      if (existing) return existing;
      return tx.agentProposal.create({
        data: { workspaceId: agent.workspaceId, tokenId: agent.tokenId, action: input.action, targetId: input.targetId, targetTitle: title, reason: input.reason },
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
        take: 50
      });
    });
    const dto = rows.map(proposalDto);
    return [...dto.filter((p) => p.status === "pending"), ...dto.filter((p) => p.status !== "pending")];
  }

  /** Approve = the human does it: the removal runs under THEIR rights, once. */
  async approve(userId: string, workspaceId: string, proposalId: string): Promise<AgentProposal> {
    const claimed = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const result = await tx.agentProposal.updateMany({
        where: { id: proposalId, workspaceId, status: "pending" },
        data: { status: "approved", decidedAt: new Date() }
      });
      if (result.count === 0) {
        const exists = await tx.agentProposal.findFirst({ where: { id: proposalId, workspaceId } });
        throw exists ? new ConflictException("Запрос уже обработан") : new NotFoundException("Запрос не найден");
      }
      return tx.agentProposal.findUniqueOrThrow({ where: { id: proposalId }, include: { token: { select: { name: true } } } });
    });
    try {
      const action = agentProposalActionSchema.parse(claimed.action);
      if (action === "task.delete") await this.tasks.remove(userId, workspaceId, claimed.targetId);
      else await this.notes.remove(userId, workspaceId, claimed.targetId);
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

  private async targetTitleTx(tx: Prisma.TransactionClient, workspaceId: string, action: string, targetId: string): Promise<string> {
    if (action === "task.delete") {
      const task = await tx.task.findUnique({ where: { id: targetId } });
      if (!task || task.workspaceId !== workspaceId) throw new NotFoundException("Задача не найдена");
      return task.title;
    }
    const note = await tx.note.findUnique({ where: { id: targetId } });
    if (!note || note.workspaceId !== workspaceId || note.deletedAt) throw new NotFoundException("Заметка не найдена");
    return note.title;
  }
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
    status: row.status === "approved" || row.status === "rejected" ? row.status : "pending",
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null
  };
}
