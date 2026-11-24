import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  type AgentHubExecution,
  type AgentHubCreateExecutionInput,
  type AgentHubEvent
} from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { ModulesService } from "../../modules/modules.service";
import { TaskIntegrationReader } from "../../tasks/public/task-integration-reader";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { executionDto, eventDto } from "./agent-hub-dto";
import { AgentHubTransitions } from "./agent-hub-transitions.service";

const LIMIT = 100;

/**
 * Durable user-facing coordination records. NOT a runtime scheduler.
 *
 * Every read/write uses the same withUser RLS context as other workspace
 * modules. Writes require a workspace owner/lead and are transactional.
 * State + its append-only event commit atomically. Lease claims must later
 * be issued by a trusted, separately authorized coordinator, not by this API.
 */
@Injectable()
export class AgentHubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService,
    private readonly tasks: TaskIntegrationReader,
    private readonly transitions: AgentHubTransitions
  ) {}

  async list(userId: string, workspaceId: string): Promise<AgentHubExecution[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.agentHubExecution.findMany({
        where: { workspaceId }, orderBy: { updatedAt: "desc" }, take: LIMIT
      });
    });
    return rows.map(executionDto);
  }

  async get(userId: string, workspaceId: string, id: string): Promise<AgentHubExecution> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const row = await tx.agentHubExecution.findFirst({ where: { id, workspaceId } });
      if (!row) throw new NotFoundException("Исполнение не найдено");
      return executionDto(row);
    });
  }

  async events(userId: string, workspaceId: string, executionId: string): Promise<AgentHubEvent[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const target = await tx.agentHubExecution.findFirst({ where: { id: executionId, workspaceId }, select: { id: true } });
      if (!target) throw new NotFoundException("Исполнение не найдено");
      const rows = await tx.agentHubEvent.findMany({
        where: { workspaceId, executionId }, orderBy: { revision: "asc" }, take: 500
      });
      return rows.map(eventDto);
    });
  }

  async create(userId: string, workspaceId: string, input: AgentHubCreateExecutionInput): Promise<AgentHubExecution> {
    const executionId = input.requestId ?? randomUUID();
    try {
      return await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
        await this.modules.assertEnabledTx(tx, userId, workspaceId, "tasks");
        const existing = await tx.agentHubExecution.findFirst({ where: { id: executionId, workspaceId } });
        if (existing) {
          if (existing.targetKind !== "task" || existing.targetId !== input.taskId) {
            throw new ConflictException("Ключ запроса уже связан с другой задачей");
          }
          return executionDto(existing);
        }
        const task = await this.tasks.referenceTx(tx, workspaceId, input.taskId);
        if (!task) throw new NotFoundException("Задача не найдена");
        if (task.assigneeId) throw new ConflictException("Снимите назначение участника команды перед созданием исполнения ИИ-агента");
        const now = new Date();
        const row = await tx.agentHubExecution.create({
          data: {
            id: executionId, workspaceId, targetKind: "task", targetId: task.id,
            status: "queued", revision: 0, attempt: 0, evidenceRefs: [],
            createdAt: now, updatedAt: now
          }
        });
        await tx.agentHubEvent.create({
          data: {
            workspaceId, executionId, revision: 0, action: "create", actorId: userId,
            data: { targetKind: "task", targetId: task.id }, at: now
          }
        });
        return executionDto(row);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Исполнение уже существует или задача уже ожидает выполнения");
      }
      throw error;
    }
  }

  async review(
    userId: string, workspaceId: string, id: string, expectedRevision: number, reason?: string
  ): Promise<AgentHubExecution> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
      const row = await this.transitions.loadTx(tx, workspaceId, id);
      const review = { expectedRevision, reviewerId: userId, at: new Date().toISOString() };
      return this.transitions.commitTx(tx, row, reason
        ? { ...review, type: "return_for_rework", reason }
        : { ...review, type: "verify" }, userId, {
        reviewerId: userId, reason: reason ?? null, evidenceRefs: row.evidenceRefs, resultSummary: row.resultSummary
      });
    });
  }

  /** Only the signed-in owner/lead may cancel from the human API. */
  async cancel(userId: string, workspaceId: string, id: string, expectedRevision: number): Promise<AgentHubExecution> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
      const row = await this.transitions.loadTx(tx, workspaceId, id);
      return this.transitions.commitTx(tx, row, {
        type: "cancel", expectedRevision, at: new Date().toISOString()
      }, userId, {});
    });
  }
}
