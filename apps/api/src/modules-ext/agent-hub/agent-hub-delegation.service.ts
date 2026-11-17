import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  AGENT_HUB_DEFAULT_MAX_DELEGATION_DEPTH,
  agentHubApprovalPauseRequired,
  agentHubDelegationPolicySchema,
  effectiveAgentHubDelegationDepth,
  planAgentHubDelegation,
  type AgentHubApproveInput,
  type AgentHubApprovalRequestInput,
  type AgentHubDelegateInput,
  type AgentHubDelegationPolicy,
  type AgentHubDelegationPolicyInput,
  type AgentHubDelegationResult,
  type AgentHubExecution,
  type AgentHubReassignInput,
  type AgentHubReassignResult,
  type AgentHubRejectInput
} from "@orion/shared-types";
import type { AgentContext } from "../../ai/public/agent-context";
import { AgentCredentialReader } from "../../ai/public/agent-credential-reader";
import { PrismaService } from "../../common/prisma.service";
import { ModulesService } from "../../modules/modules.service";
import { ProjectReferences } from "../../projects/public/project-references";
import { TaskIntegrationReader } from "../../tasks/public/task-integration-reader";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { executionDto } from "./agent-hub-dto";
import { AgentHubTransitions } from "./agent-hub-transitions.service";

/**
 * Delegation branches, the human approval gate and the owner-controlled depth
 * policy (tasks 09.1 and 09.4).
 *
 * Delegation never widens a token's scope: the child branch inherits the
 * project fence of the governing task and records the permission constraints it
 * was created with. `waiting_approval` is the only path for an operation above
 * read-only; it is not a way to raise the scope-ceiling.
 */
@Injectable()
export class AgentHubDelegationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService,
    private readonly tasks: TaskIntegrationReader,
    private readonly projects: ProjectReferences,
    private readonly credentials: AgentCredentialReader,
    private readonly transitions: AgentHubTransitions
  ) {}

  private async assertEnabledTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string): Promise<void> {
    await this.workspaces.assertMemberTx(tx, userId, workspaceId);
    await this.modules.assertEnabledTx(tx, userId, workspaceId, "agent-hub");
    await this.modules.assertEnabledTx(tx, userId, workspaceId, "tasks");
  }

  private async maxDepthTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<number> {
    const row = await tx.agentHubPolicy.findUnique({ where: { workspaceId }, select: { maxDelegationDepth: true } });
    return row?.maxDelegationDepth ?? AGENT_HUB_DEFAULT_MAX_DELEGATION_DEPTH;
  }

  private policyDto(workspaceId: string, row: { maxDelegationDepth: number; approvals?: string; updatedAt: Date } | null): AgentHubDelegationPolicy {
    return agentHubDelegationPolicySchema.parse({
      workspaceId,
      maxDelegationDepth: row?.maxDelegationDepth ?? AGENT_HUB_DEFAULT_MAX_DELEGATION_DEPTH,
      // Старые строки без колонки (до миграции) получают дефолт схемы.
      ...(row?.approvals ? { approvals: row.approvals } : {}),
      updatedAt: row?.updatedAt.toISOString() ?? null
    });
  }

  async policy(userId: string, workspaceId: string): Promise<AgentHubDelegationPolicy> {
    return this.prisma.withUser(userId, async tx => {
      await this.assertEnabledTx(tx, userId, workspaceId);
      const row = await tx.agentHubPolicy.findUnique({ where: { workspaceId } });
      return this.policyDto(workspaceId, row);
    });
  }

  /** Only the workspace owner/lead sets the delegating limit and the approval gate; agents can never raise them. */
  async setPolicy(userId: string, workspaceId: string, input: AgentHubDelegationPolicyInput): Promise<AgentHubDelegationPolicy> {
    return this.prisma.withUser(userId, async tx => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "agent-hub");
      const row = await tx.agentHubPolicy.upsert({
        where: { workspaceId },
        create: { workspaceId, maxDelegationDepth: input.maxDelegationDepth, approvals: input.approvals ?? "non_admin", updatedById: userId },
        update: { maxDelegationDepth: input.maxDelegationDepth, ...(input.approvals ? { approvals: input.approvals } : {}), updatedById: userId }
      });
      return this.policyDto(workspaceId, row);
    });
  }

  private async assertProfileWithActiveCredentialTx(
    tx: Prisma.TransactionClient, userId: string, workspaceId: string, profileId: string
  ): Promise<void> {
    const bindings = await tx.agentHubAgentCredential.findMany({
      where: { workspaceId, profileId }, select: { tokenId: true }
    });
    for (const binding of bindings) {
      if (await this.credentials.stateTx(tx, userId, workspaceId, binding.tokenId) === "active") return;
    }
    throw new ConflictException("У профиля нет действующего credential; перепривяжите его перед делегированием");
  }

  async delegate(agent: AgentContext, parentExecutionId: string, input: AgentHubDelegateInput): Promise<AgentHubDelegationResult> {
    return this.prisma.withUser(agent.userId, async tx => {
      await this.assertEnabledTx(tx, agent.userId, agent.workspaceId);
      const parent = await this.transitions.loadTx(tx, agent.workspaceId, parentExecutionId);
      await this.transitions.accessibleTx(tx, agent, parent);
      if (parent.workerId !== agent.tokenId) throw new ForbiddenException("Делегировать может только текущий исполнитель");
      const now = new Date();
      if (parent.status !== "working") throw new ConflictException("delegation_requires_working");
      if (!parent.leaseUntil || parent.leaseUntil.getTime() <= now.getTime()) throw new ConflictException("lease_expired");
      const delegatorProfileId = await this.transitions.profileIdForTokenTx(tx, agent.workspaceId, agent.tokenId);
      if (!delegatorProfileId) throw new ForbiddenException("Делегирование доступно только токену, привязанному к профилю агента");

      const target = await tx.agentHubAgentProfile.findFirst({ where: { id: input.targetAgentId, workspaceId: agent.workspaceId } });
      if (!target) throw new NotFoundException("Профиль агента не найден");
      await this.assertProfileWithActiveCredentialTx(tx, agent.userId, agent.workspaceId, target.id);

      const maxDepth = effectiveAgentHubDelegationDepth(
        await this.maxDepthTx(tx, agent.workspaceId),
        input.constraints?.maxDepth
      );
      const plan = planAgentHubDelegation({
        parentChain: stringArray(parent.delegationChain),
        parentDepth: parent.delegationDepth,
        parentDelegatedTo: parent.delegatedToProfileId,
        delegatorProfileId,
        targetProfileId: target.id,
        maxDepth
      });
      if (!plan.ok) throw new ConflictException(plan.reason);

      const taskId = input.taskId ?? (parent.targetKind === "task" ? parent.targetId : null);
      let taskProjectId: string | null = null;
      if (taskId) {
        const task = await this.tasks.referenceTx(tx, agent.workspaceId, taskId);
        if (!task) throw new NotFoundException("Задача подпоручения не найдена");
        taskProjectId = task.projectId;
      }
      const projectId = input.projectId ?? taskProjectId;
      if (projectId) {
        if (!await this.projects.existsTx(tx, agent.workspaceId, projectId)) {
          throw new NotFoundException("Проект подпоручения не найден");
        }
      }
      if (agent.allowedProjectIds.length > 0 && (!projectId || !agent.allowedProjectIds.includes(projectId))) {
        throw new ForbiddenException("Подпоручение вне разрешённых проектов токена");
      }

      const childId = randomUUID();
      const payload = {
        summary: input.summary,
        instructions: input.instructions ?? null,
        taskId,
        projectId,
        materialLinkIds: input.materialLinkIds ?? [],
        constraints: input.constraints ?? {},
        delegatedByProfileId: delegatorProfileId
      } as Prisma.InputJsonValue;
      const child = await tx.agentHubExecution.create({
        data: {
          id: childId, workspaceId: agent.workspaceId,
          targetKind: "delegation", targetId: childId,
          status: "queued", revision: 0, attempt: 0, evidenceRefs: [],
          parentExecutionId: parent.id, delegationDepth: plan.depth,
          delegatedToProfileId: target.id,
          delegationChain: plan.chain as Prisma.InputJsonValue,
          delegationPayload: payload,
          createdAt: now, updatedAt: now
        }
      });
      await tx.agentHubEvent.create({
        data: {
          workspaceId: agent.workspaceId, executionId: childId, revision: 0,
          action: "create", actorId: agent.tokenId,
          data: { parentExecutionId: parent.id, delegatedToProfileId: target.id, delegationDepth: plan.depth },
          at: now
        }
      });
      // The parent's revision belongs to its worker: delegation is a trace fact, not a state transition.
      await tx.agentHubTraceStep.create({
        data: {
          workspaceId: agent.workspaceId, executionId: parent.id,
          stepId: `delegate:${childId}`, parentStepId: null,
          type: "delegation", name: "delegate", agentId: delegatorProfileId, actorId: agent.tokenId,
          payload: {
            childExecutionId: childId, targetAgentId: target.id, delegationDepth: plan.depth,
            summary: input.summary, constraints: input.constraints ?? {}
          } as Prisma.InputJsonValue,
          at: now
        }
      });
      await tx.agentHubTraceStep.create({
        data: {
          workspaceId: agent.workspaceId, executionId: childId,
          stepId: `delegated-from:${parent.id}`, parentStepId: null,
          type: "delegation", name: "delegated_from", agentId: delegatorProfileId, actorId: agent.tokenId,
          payload: { parentExecutionId: parent.id, summary: input.summary } as Prisma.InputJsonValue,
          at: now
        }
      });
      return { parent: executionDto(parent), execution: executionDto(child) };
    });
  }

  /**
   * An agent above read-only asks a human to decide; the execution pauses until then.
   * P3-1: с политикой `non_admin` (дефолт) администратор — токен с режимом `admin`, выбранным
   * владельцем при выпуске credential — не встаёт на паузу: запрос фиксируется в trace как
   * auto_approved, исполнение продолжает работу. Политика `all` возвращает поведение
   * задания 09 (пауза для каждого запроса).
   */
  async requestApproval(agent: AgentContext, executionId: string, input: AgentHubApprovalRequestInput): Promise<AgentHubExecution> {
    return this.prisma.withUser(agent.userId, async tx => {
      await this.assertEnabledTx(tx, agent.userId, agent.workspaceId);
      const row = await this.transitions.loadTx(tx, agent.workspaceId, executionId);
      await this.transitions.accessibleTx(tx, agent, row);
      const profileId = await this.transitions.profileIdForTokenTx(tx, agent.workspaceId, agent.tokenId);
      const now = new Date();

      const policyRow = await tx.agentHubPolicy.findUnique({ where: { workspaceId: agent.workspaceId }, select: { approvals: true } });
      // Колонка TEXT: неизвестное значение трактуем как дефолт пространства.
      const approvals: "non_admin" | "all" = policyRow?.approvals === "all" ? "all" : "non_admin";
      // P3-1: «Администратор» — режим токена (agentMode === "admin"), выбранный владельцем при выпуске.
      const isAdminAgent = agent.mode === "admin";
      if (!agentHubApprovalPauseRequired(approvals, isAdminAgent)) {
        await tx.agentHubTraceStep.create({
          data: {
            workspaceId: agent.workspaceId, executionId: row.id,
            stepId: `approval-auto:${row.revision + 1}`, parentStepId: null,
            type: "approval_wait", name: "auto_approved", agentId: profileId, actorId: agent.tokenId,
            payload: { action: input.action, reason: input.reason, state: "auto_approved", mode: agent.mode } as Prisma.InputJsonValue,
            at: now
          }
        });
        return executionDto(row);
      }

      const next = await this.transitions.commitTx(tx, row, {
        type: "request_approval", expectedRevision: input.expectedRevision,
        at: now.toISOString(), workerId: agent.tokenId,
        action: input.action, reason: input.reason
      }, agent.tokenId, { action: input.action, reason: input.reason });
      await tx.agentHubTraceStep.create({
        data: {
          workspaceId: agent.workspaceId, executionId: row.id,
          stepId: `approval-wait:${next.revision}`, parentStepId: null,
          type: "approval_wait", name: "requested", agentId: profileId, actorId: agent.tokenId,
          payload: { action: input.action, reason: input.reason, state: "pending" } as Prisma.InputJsonValue,
          at: now
        }
      });
      return next;
    });
  }

  private async decide(
    userId: string, workspaceId: string, executionId: string,
    kind: "approve" | "reject", expectedRevision: number, reason: string
  ): Promise<AgentHubExecution> {
    return this.prisma.withUser(userId, async tx => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "agent-hub");
      const row = await this.transitions.loadTx(tx, workspaceId, executionId);
      const now = new Date();
      const command = kind === "approve"
        ? { type: "approve" as const, expectedRevision, at: now.toISOString(), reviewerId: userId }
        : { type: "reject" as const, expectedRevision, at: now.toISOString(), reviewerId: userId, reason };
      const next = await this.transitions.commitTx(tx, row, command, userId, { reviewerId: userId, reason });
      await tx.agentHubTraceStep.create({
        data: {
          workspaceId, executionId, stepId: `approval-decision:${next.revision}`, parentStepId: null,
          type: "approval_wait", name: kind === "approve" ? "approved" : "rejected",
          agentId: null, actorId: userId,
          payload: { reviewerId: userId, state: kind === "approve" ? "approved" : "rejected", reason } as Prisma.InputJsonValue,
          at: now
        }
      });
      return next;
    });
  }

  approve(userId: string, workspaceId: string, executionId: string, input: AgentHubApproveInput): Promise<AgentHubExecution> {
    return this.decide(userId, workspaceId, executionId, "approve", input.expectedRevision, "Одобрено владельцем");
  }

  reject(userId: string, workspaceId: string, executionId: string, input: AgentHubRejectInput): Promise<AgentHubExecution> {
    return this.decide(userId, workspaceId, executionId, "reject", input.expectedRevision, input.reason);
  }

  /**
   * Ends the current branch and opens an independent replacement for the same
   * target. The old execution keeps its journal; the new one starts clean and is
   * fenced to the chosen profile (or open to the queue when `agentId` is null).
   */
  async reassign(userId: string, workspaceId: string, executionId: string, input: AgentHubReassignInput): Promise<AgentHubReassignResult> {
    return this.prisma.withUser(userId, async tx => {
      await this.assertEnabledTx(tx, userId, workspaceId);
      const row = await this.transitions.loadTx(tx, workspaceId, executionId);
      if (input.agentId) {
        const profile = await tx.agentHubAgentProfile.findFirst({ where: { id: input.agentId, workspaceId } });
        if (!profile) throw new NotFoundException("Профиль агента не найден");
        await this.assertProfileWithActiveCredentialTx(tx, userId, workspaceId, profile.id);
      }
      const now = new Date();
      const previous = await this.transitions.commitTx(tx, row, {
        type: "reassign", expectedRevision: input.expectedRevision, at: now.toISOString(),
        reason: input.reason
      }, userId, { agentId: input.agentId, reason: input.reason ?? null });

      const chain = stringArray(row.delegationChain);
      if (input.agentId && !chain.includes(input.agentId)) chain.push(input.agentId);
      const replacementId = randomUUID();
      const replacement = await tx.agentHubExecution.create({
        data: {
          id: replacementId, workspaceId,
          targetKind: row.targetKind, targetId: row.targetKind === "task" ? row.targetId : replacementId,
          status: "queued", revision: 0, attempt: 0, evidenceRefs: [],
          parentExecutionId: row.parentExecutionId, delegationDepth: row.delegationDepth,
          delegatedToProfileId: input.agentId,
          delegationChain: chain as Prisma.InputJsonValue,
          delegationPayload: row.delegationPayload as Prisma.InputJsonValue,
          createdAt: now, updatedAt: now
        }
      });
      await tx.agentHubEvent.create({
        data: {
          workspaceId, executionId: replacementId, revision: 0, action: "create", actorId: userId,
          data: { reassignedFrom: row.id, delegatedToProfileId: input.agentId }, at: now
        }
      });
      await tx.agentHubTraceStep.create({
        data: {
          workspaceId, executionId: replacementId, stepId: `reassigned-from:${row.id}`, parentStepId: null,
          type: "note", name: "reassigned_from", agentId: input.agentId, actorId: userId,
          payload: { previousExecutionId: row.id, reason: input.reason ?? null } as Prisma.InputJsonValue,
          at: now
        }
      });
      return { previous, execution: executionDto(replacement) };
    });
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
