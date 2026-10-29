import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type AgentHubExecution as ExecutionRow } from "@prisma/client";
import {
  transitionAgentHubExecution, AgentHubTransitionError,
  type AgentHubCommand, type AgentHubExecution, type AgentHubReportInput
} from "@orion/shared-types";
import type { AgentContext } from "../../ai/agent-tokens.service";
import { PrismaService } from "../../common/prisma.service";
import { ModulesService } from "../../modules/modules.service";
import { TaskIntegrationReader } from "../../tasks/public/task-integration-reader";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { executionDto } from "./agent-hub.service";

const LEASE_MS = 120_000;
/** This is a manual MCP adapter, not a process identity or proof of a live IDE. */
const runtimeOf = (agent: AgentContext): string => `manual-mcp:${agent.tokenId}`;

@Injectable()
export class AgentHubWorkerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService,
    private readonly tasks: TaskIntegrationReader
  ) {}

  /** Project fences and task read scope are mandatory even if the caller has the Agent Hub tool permission. */
  private async accessibleTx(tx: Prisma.TransactionClient, agent: AgentContext, row: ExecutionRow): Promise<void> {
    if (!agent.scopes.includes("tasks:read")) throw new ForbiddenException("Нужно разрешение tasks:read");
    if (row.targetKind !== "task") throw new ForbiddenException("Этот тип исполнения пока не поддерживается");
    const task = await this.tasks.referenceTx(tx, agent.workspaceId, row.targetId);
    if (!task) throw new NotFoundException("Связанная задача недоступна");
    if (agent.allowedProjectIds.length > 0 && (!task.projectId || !agent.allowedProjectIds.includes(task.projectId))) {
      throw new ForbiddenException("Задача вне разрешённых проектов токена");
    }
  }

  /** The token sees queued jobs and its own claimed/working jobs, never other workers' active jobs. */
  async queue(agent: AgentContext): Promise<AgentHubExecution[]> {
    return this.prisma.withUser(agent.userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, agent.userId, agent.workspaceId);
      await this.modules.assertEnabledTx(tx, agent.userId, agent.workspaceId, "agent-hub");
      await this.modules.assertEnabledTx(tx, agent.userId, agent.workspaceId, "tasks");
      if (!agent.scopes.includes("tasks:read")) throw new ForbiddenException("Нужно разрешение tasks:read");
      const rows = await tx.agentHubExecution.findMany({
        where: {
          workspaceId: agent.workspaceId,
          OR: [{ status: "queued" }, { status: { in: ["claimed", "working"] }, workerId: agent.tokenId }]
        },
        orderBy: { updatedAt: "desc" }, take: 100
      });
      const visible: AgentHubExecution[] = [];
      for (const row of rows) {
        if (row.targetKind !== "task") continue;
        const task = await this.tasks.referenceTx(tx, agent.workspaceId, row.targetId);
        if (!task) continue;
        if (agent.allowedProjectIds.length > 0 && (!task.projectId || !agent.allowedProjectIds.includes(task.projectId))) continue;
        visible.push(executionDto(row));
      }
      return visible;
    });
  }

  /** Server-generated command actor/time; optimistic concurrency is checked by updateMany. */
  private async commitTx(
    tx: Prisma.TransactionClient,
    current: ExecutionRow,
    command: AgentHubCommand,
    actorId: string,
    metadata: Record<string, string | string[]> = {}
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
        updatedAt: new Date(next.updatedAt)
      }
    });
    if (changed.count !== 1) throw new ConflictException("Исполнение изменилось одновременно");
    await tx.agentHubEvent.create({
      data: {
        workspaceId: current.workspaceId, executionId: current.id,
        revision: next.revision, action: command.type, actorId,
        data: metadata, at: new Date(command.at)
      }
    });
    return next;
  }

  async claim(agent: AgentContext, executionId: string, expectedRevision: number): Promise<AgentHubExecution> {
    return this.prisma.withUser(agent.userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, agent.userId, agent.workspaceId);
      await this.modules.assertEnabledTx(tx, agent.userId, agent.workspaceId, "agent-hub");
      await this.modules.assertEnabledTx(tx, agent.userId, agent.workspaceId, "tasks");
      const row = await tx.agentHubExecution.findFirst({ where: { id: executionId, workspaceId: agent.workspaceId } });
      if (!row) throw new NotFoundException("Исполнение не найдено");
      await this.accessibleTx(tx, agent, row);
      const command = {
        type: "claim" as const, expectedRevision, at: new Date().toISOString(),
        workerId: agent.tokenId, runtimeId: runtimeOf(agent), leaseMs: LEASE_MS
      };
      return this.commitTx(tx, row, command, agent.tokenId, { kind: "manual_mcp" });
    });
  }

  async report(
    agent: AgentContext,
    executionId: string,
    input: AgentHubReportInput
  ): Promise<AgentHubExecution> {
    return this.prisma.withUser(agent.userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, agent.userId, agent.workspaceId);
      await this.modules.assertEnabledTx(tx, agent.userId, agent.workspaceId, "agent-hub");
      await this.modules.assertEnabledTx(tx, agent.userId, agent.workspaceId, "tasks");
      const row = await tx.agentHubExecution.findFirst({ where: { id: executionId, workspaceId: agent.workspaceId } });
      if (!row) throw new NotFoundException("Исполнение не найдено");
      await this.accessibleTx(tx, agent, row);
      const shared = { expectedRevision: input.expectedRevision, at: new Date().toISOString(), workerId: agent.tokenId };
      const command: AgentHubCommand = input.action === "start"
        ? { ...shared, type: "start" }
        : input.action === "heartbeat"
          ? { ...shared, type: "heartbeat", leaseMs: LEASE_MS }
          : input.action === "checkpoint"
            ? { ...shared, type: "checkpoint", checkpointRef: input.checkpointRef }
            : input.action === "submit"
              ? { ...shared, type: "submit", evidenceRefs: input.evidenceRefs }
              : input.action === "block"
                ? { ...shared, type: "block", reason: input.reason }
                : { ...shared, type: "fail", reason: input.reason };
      const metadata: Record<string, string | string[]> = {};
      if (input.action === "block" || input.action === "fail") metadata.reason = input.reason;
      if (input.action === "checkpoint") metadata.checkpointRef = input.checkpointRef;
      if (input.action === "submit") metadata.evidenceRefs = input.evidenceRefs;
      // These are unverified references; they do NOT close the Task automatically.
      return this.commitTx(tx, row, command, agent.tokenId, metadata);
    });
  }

  /**
   * Explicit human-triggered reconciliation. Uses server time and lease guards.
   * No background poller exists: until the owner invokes this, an expired job
   * remains visibly stale. This never treats disconnection as completion.
   */
  async reconcileExpired(userId: string, workspaceId: string): Promise<{ recovered: number }> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
      const now = new Date();
      const stale = await tx.agentHubExecution.findMany({
        where: { workspaceId, status: { in: ["claimed", "working"] }, leaseUntil: { lte: now } },
        orderBy: { leaseUntil: "asc" }, take: 50
      });
      let recovered = 0;
      for (const row of stale) {
        try {
          await this.commitTx(tx, row, {
            type: "expire", expectedRevision: row.revision, at: now.toISOString()
          }, userId, { reason: "lease_expired" });
          recovered++;
        } catch (error) {
          // A concurrent fresh heartbeat wins; do not reclaim its lease.
          if (!(error instanceof ConflictException)) throw error;
        }
      }
      return { recovered };
    });
  }
}
