import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type AgentHubTraceStep as StepRow } from "@prisma/client";
import {
  buildAgentHubTraceTree,
  type AgentHubTraceFilters,
  type AgentHubTraceRecordInput,
  type AgentHubTraceResponse,
  type AgentHubTraceStep
} from "@orion/shared-types";
import type { AgentContext } from "../../ai/public/agent-context";
import { PrismaService } from "../../common/prisma.service";
import { ModulesService } from "../../modules/modules.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { AgentHubTransitions } from "./agent-hub-transitions.service";

const MAX_TRACE_STEPS = 1000;
/** A step is only accepted while the execution actually runs (or waits for a human). */
const OPEN_FOR_STEPS = new Set(["claimed", "working", "waiting_approval", "review"]);
/** Delegation/approval facts belong to the service transactions, not to a self-report. */
const AGENT_REPORTABLE_STEPS = new Set(["tool_call", "tool_result", "note", "error"]);

/**
 * Trace View data layer (task 09.2).
 *
 * Steps are facts an executor reports, plus delegation/approval facts the
 * service writes inside the same transactions that change state. Nothing here
 * records or reconstructs a model's private reasoning.
 */
@Injectable()
export class AgentHubTraceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService,
    private readonly transitions: AgentHubTransitions
  ) {}

  private stepDto(row: StepRow): AgentHubTraceStep {
    return {
      id: row.id, workspaceId: row.workspaceId, executionId: row.executionId,
      stepId: row.stepId, parentStepId: row.parentStepId, type: row.type as AgentHubTraceStep["type"],
      name: row.name, agentId: row.agentId, actorId: row.actorId,
      payload: row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload as Record<string, unknown> : {},
      durationMs: row.durationMs, error: row.error, attempt: row.attempt, at: row.at.toISOString()
    };
  }

  async record(agent: AgentContext, executionId: string, input: AgentHubTraceRecordInput): Promise<AgentHubTraceStep> {
    try {
      return await this.prisma.withUser(agent.userId, async tx => {
        await this.workspaces.assertMemberTx(tx, agent.userId, agent.workspaceId);
        await this.modules.assertEnabledTx(tx, agent.userId, agent.workspaceId, "agent-hub");
        const row = await this.transitions.loadTx(tx, agent.workspaceId, executionId);
        await this.transitions.accessibleTx(tx, agent, row);
        if (row.workerId !== agent.tokenId) throw new ForbiddenException("Шаги исполнения пишет только текущий исполнитель");
        if (!OPEN_FOR_STEPS.has(row.status)) throw new ConflictException("Исполнение уже не принимает шаги");
        if (!AGENT_REPORTABLE_STEPS.has(input.type)) {
          throw new BadRequestException("Тип шага делегирования или ожидания подтверждения фиксирует сервер");
        }

        const now = new Date();
        const parent = input.parentStepId
          ? await tx.agentHubTraceStep.findFirst({ where: { workspaceId: agent.workspaceId, executionId, stepId: input.parentStepId } })
          : null;
        if (input.parentStepId && !parent) throw new BadRequestException("Родительский шаг не найден");
        if (input.type === "tool_result" && parent?.type !== "tool_call") {
          throw new BadRequestException("tool_result должен ссылаться на шаг tool_call через parentStepId");
        }
        const durationMs = input.durationMs
          ?? (parent ? Math.max(0, now.getTime() - parent.at.getTime()) : null);
        const agentId = await this.transitions.profileIdForTokenTx(tx, agent.workspaceId, agent.tokenId);
        const created = await tx.agentHubTraceStep.create({
          data: {
            workspaceId: agent.workspaceId, executionId,
            stepId: input.stepId, parentStepId: input.parentStepId ?? null,
            type: input.type, name: input.name ?? null,
            agentId, actorId: agent.tokenId,
            payload: (input.payload ?? {}) as Prisma.InputJsonValue,
            durationMs, error: input.error ?? null, attempt: input.attempt ?? 0,
            at: now
          }
        });
        return this.stepDto(created);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Шаг с таким stepId уже записан");
      }
      throw error;
    }
  }

  /** One endpoint for the overview and for a step subtree: `stepId` + `depth` narrow the same data. */
  async trace(
    userId: string, workspaceId: string, executionId: string, filters: AgentHubTraceFilters
  ): Promise<AgentHubTraceResponse> {
    return this.prisma.withUser(userId, async tx => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "agent-hub");
      const execution = await tx.agentHubExecution.findFirst({ where: { id: executionId, workspaceId }, select: { id: true } });
      if (!execution) throw new NotFoundException("Исполнение не найдено");
      const where: Prisma.AgentHubTraceStepWhereInput = { workspaceId, executionId };
      if (filters.types?.length) where.type = { in: filters.types };
      if (filters.agentId) where.agentId = filters.agentId;
      const rows = await tx.agentHubTraceStep.findMany({
        where, orderBy: [{ at: "asc" }, { stepId: "asc" }], take: MAX_TRACE_STEPS + 1
      });
      const truncated = rows.length > MAX_TRACE_STEPS;
      const steps = rows.slice(0, MAX_TRACE_STEPS).map(row => this.stepDto(row));
      const tree = buildAgentHubTraceTree(steps, { rootStepId: filters.stepId, depth: filters.depth });
      return { executionId, total: steps.length, steps, tree, truncated };
    });
  }
}
