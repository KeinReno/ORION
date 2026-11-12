import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type AgentHubExecution as ExecutionRow } from "@prisma/client";
import {
  AGENT_HUB_TERMINAL_STATUS_SET,
  AgentHubTransitionError,
  transitionAgentHubExecution,
  type AgentHubCommand,
  type AgentHubExecution
} from "@orion/shared-types";
import type { AgentContext } from "../../ai/public/agent-context";
import { TaskIntegrationReader, type TaskReference } from "../../tasks/public/task-integration-reader";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { executionDto } from "./agent-hub-dto";

/** A delegation chain is bounded by policy (max 6); this guard only protects the walk itself. */
const MAX_ANCESTOR_WALK = 10;

/**
 * Shared transactional primitives of the Agent Hub execution machine: the RLS
 * context, the project fence of an execution (including a delegated branch) and
 * the compare-and-set commit that writes state and its journal row atomically.
 * State changes are only ever applied through `commitTx`, so every caller gets
 * the allowed-transition check and the audit event for free.
 */
@Injectable()
export class AgentHubTransitions {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly tasks: TaskIntegrationReader
  ) {}

  /** The stable profile bound to a credential, if the token was linked to one. */
  async profileIdForTokenTx(tx: Prisma.TransactionClient, workspaceId: string, tokenId: string): Promise<string | null> {
    const binding = await tx.agentHubAgentCredential.findFirst({
      where: { workspaceId, tokenId }, select: { profileId: true }
    });
    return binding?.profileId ?? null;
  }

  /** The Task a branch ultimately works on; a delegation may be task-less. */
  async governingTaskTx(tx: Prisma.TransactionClient, row: ExecutionRow): Promise<TaskReference | null> {
    let current: ExecutionRow | null = row;
    for (let depth = 0; current && depth < MAX_ANCESTOR_WALK; depth++) {
      if (current.targetKind === "task") return this.tasks.referenceTx(tx, current.workspaceId, current.targetId);
      if (current.targetKind !== "delegation") throw new ForbiddenException("Этот тип исполнения пока не поддерживается");
      if (!current.parentExecutionId) return null;
      current = await tx.agentHubExecution.findFirst({
        where: { id: current.parentExecutionId, workspaceId: current.workspaceId }
      });
    }
    throw new ForbiddenException("Цепочка делегирования повреждена");
  }

  /** Project fences and task read scope are mandatory even if the caller has the Agent Hub tool permission. */
  async accessibleTx(tx: Prisma.TransactionClient, agent: AgentContext, row: ExecutionRow): Promise<void> {
    if (!agent.scopes.includes("tasks:read")) throw new ForbiddenException("Нужно разрешение tasks:read");
    const task = await this.governingTaskTx(tx, row);
    if (!task) return;
    if (agent.allowedProjectIds.length > 0 && (!task.projectId || !agent.allowedProjectIds.includes(task.projectId))) {
      throw new ForbiddenException("Задача вне разрешённых проектов токена");
    }
  }

  /** Loads an execution of this workspace or fails with the same 404 for every outsider. */
  async loadTx(tx: Prisma.TransactionClient, workspaceId: string, executionId: string): Promise<ExecutionRow> {
    const row = await tx.agentHubExecution.findFirst({ where: { id: executionId, workspaceId } });
    if (!row) throw new NotFoundException("Исполнение не найдено");
    return row;
  }

  /**
   * CAS on `revision`: state, attempt/lease/approval and the journal row commit
   * together, and a lost race is a 409, never a silent overwrite.
   */
  async commitTx(
    tx: Prisma.TransactionClient,
    current: ExecutionRow,
    command: AgentHubCommand,
    actorId: string,
    metadata: Record<string, unknown> = {}
  ): Promise<AgentHubExecution> {
    let next: AgentHubExecution;
    try {
      next = transitionAgentHubExecution(executionDto(current), command);
    } catch (error) {
      if (error instanceof AgentHubTransitionError) throw new ConflictException(error.code);
      throw error;
    }
    const changed = await tx.agentHubExecution.updateMany({
      where: { id: current.id, workspaceId: current.workspaceId, revision: command.expectedRevision },
      data: {
        status: next.status, revision: next.revision, attempt: next.attempt,
        workerId: next.workerId, runtimeId: next.runtimeId,
        leaseUntil: next.leaseUntil ? new Date(next.leaseUntil) : null,
        checkpointRef: next.checkpointRef, evidenceRefs: next.evidenceRefs,
        verifiedBy: next.verifiedBy, blockedReason: next.blockedReason,
        approval: next.approval === null ? Prisma.DbNull : next.approval as Prisma.InputJsonValue,
        resultSummary: next.resultSummary,
        updatedAt: new Date(next.updatedAt)
      }
    });
    if (changed.count !== 1) throw new ConflictException("Исполнение изменилось одновременно");
    await tx.agentHubEvent.create({
      data: {
        workspaceId: current.workspaceId, executionId: current.id,
        revision: next.revision, action: command.type, actorId,
        data: metadata as Prisma.InputJsonValue, at: new Date(command.at)
      }
    });
    if (AGENT_HUB_TERMINAL_STATUS_SET.has(next.status) && !AGENT_HUB_TERMINAL_STATUS_SET.has(current.status as AgentHubExecution["status"])) {
      await this.notifyParentTx(tx, next, actorId);
    }
    return next;
  }

  /**
   * A finished child hands a short summary back to its parent branch. It is a
   * trace note, not a state transition: the parent's revision belongs to its own
   * worker and must not move because a child finished.
   */
  private async notifyParentTx(tx: Prisma.TransactionClient, child: AgentHubExecution, actorId: string): Promise<void> {
    if (!child.parentExecutionId) return;
    const parent = await tx.agentHubExecution.findFirst({
      where: { id: child.parentExecutionId, workspaceId: child.workspaceId }, select: { id: true }
    });
    if (!parent) return;
    const fallback = child.status === "done" ? "Дочернее исполнение завершено и проверено"
      : child.status === "failed" ? "Дочернее исполнение завершилось ошибкой"
        : child.status === "reassigned" ? "Дочернее исполнение переназначено" : "Дочернее исполнение отменено";
    try {
      await tx.agentHubTraceStep.create({
        data: {
          workspaceId: child.workspaceId, executionId: parent.id,
          stepId: `delegation-result:${child.id}`, parentStepId: null,
          type: "note", name: "delegation_result",
          agentId: child.delegatedToProfileId, actorId,
          payload: {
            childExecutionId: child.id, status: child.status,
            summary: child.resultSummary?.trim() || fallback,
            evidenceRefs: child.evidenceRefs, checkpointRef: child.checkpointRef,
            blockedReason: child.blockedReason
          } as Prisma.InputJsonValue,
          at: new Date()
        }
      });
    } catch (error) {
      // The same child can only notify once; a duplicate delivery must not fail the transition.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    }
  }

  /** Shared guard for human-only operations: inside a transaction, with membership and both modules enabled. */
  async assertLeadTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string): Promise<void> {
    await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
  }

  /** Member read guard reused by the trace/memory read paths. */
  async assertMemberTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string): Promise<void> {
    await this.workspaces.assertMemberTx(tx, userId, workspaceId);
  }
}
