import { ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma, type AgentHubExecution as ExecutionRow } from "@prisma/client";
import type { AgentContext } from "../../ai/public/agent-context";
import type { AgentHubCommand, AgentHubExecution, AgentHubReportInput } from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { ModulesService } from "../../modules/modules.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { executionDto } from "./agent-hub-dto";
import { AgentHubAssignmentService } from "./agent-hub-assignment.service";
import { AgentHubTransitions } from "./agent-hub-transitions.service";

const LEASE_MS = 120_000;
/** This is a manual MCP adapter, not a process identity or proof of a live IDE. */
const runtimeOf = (agent: AgentContext): string => `manual-mcp:${agent.tokenId}`;

@Injectable()
export class AgentHubWorkerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService,
    private readonly assignments: AgentHubAssignmentService,
    private readonly transitions: AgentHubTransitions
  ) {}

  /**
   * The token sees queued jobs and its own claimed/working jobs, never other
   * workers' active jobs. A delegated branch is visible only to the profile it
   * was handed to; ordinary task work keeps the durable assignment fence.
   */
  async queue(agent: AgentContext): Promise<AgentHubExecution[]> {
    return this.prisma.withUser(agent.userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, agent.userId, agent.workspaceId);
      await this.modules.assertEnabledTx(tx, agent.userId, agent.workspaceId, "agent-hub");
      await this.modules.assertEnabledTx(tx, agent.userId, agent.workspaceId, "tasks");
      if (!agent.scopes.includes("tasks:read")) throw new ForbiddenException("Нужно разрешение tasks:read");
      const profileId = await this.transitions.profileIdForTokenTx(tx, agent.workspaceId, agent.tokenId);
      const rows = await tx.agentHubExecution.findMany({
        where: {
          workspaceId: agent.workspaceId,
          OR: [{ status: "queued" }, { status: { in: ["claimed", "working"] }, workerId: agent.tokenId }]
        },
        orderBy: { updatedAt: "desc" }, take: 100
      });
      const visible: AgentHubExecution[] = [];
      for (const row of rows) {
        if (!await this.visibleToAgentTx(tx, agent, row, profileId)) continue;
        visible.push(executionDto(row));
      }
      return visible;
    });
  }

  private async visibleToAgentTx(
    tx: Prisma.TransactionClient,
    agent: AgentContext,
    row: ExecutionRow,
    profileId: string | null
  ): Promise<boolean> {
    if (row.targetKind === "delegation") {
      if (row.delegatedToProfileId && row.delegatedToProfileId !== profileId) return false;
    } else if (row.targetKind === "task") {
      if (row.status === "queued" && !await this.assignments.workerMayClaimTx(tx, agent.userId, agent.workspaceId, row.targetId, agent.tokenId)) return false;
    } else {
      return false;
    }
    let task: Awaited<ReturnType<AgentHubTransitions["governingTaskTx"]>>;
    try {
      task = await this.transitions.governingTaskTx(tx, row);
    } catch {
      return false;
    }
    if (!task) return true;
    if (agent.allowedProjectIds.length > 0 && (!task.projectId || !agent.allowedProjectIds.includes(task.projectId))) return false;
    return true;
  }

  async claim(agent: AgentContext, executionId: string, expectedRevision: number): Promise<AgentHubExecution> {
    return this.prisma.withUser(agent.userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, agent.userId, agent.workspaceId);
      await this.modules.assertEnabledTx(tx, agent.userId, agent.workspaceId, "agent-hub");
      await this.modules.assertEnabledTx(tx, agent.userId, agent.workspaceId, "tasks");
      const row = await this.transitions.loadTx(tx, agent.workspaceId, executionId);
      if (row.targetKind === "task") {
        await this.assignments.lockTaskForWorkerClaimTx(tx, agent.userId, agent.workspaceId, row.targetId, agent.tokenId);
      } else if (row.targetKind === "delegation" && row.delegatedToProfileId) {
        const profileId = await this.transitions.profileIdForTokenTx(tx, agent.workspaceId, agent.tokenId);
        if (profileId !== row.delegatedToProfileId) throw new ForbiddenException("Подпоручение передано другому профилю агента");
      }
      await this.transitions.accessibleTx(tx, agent, row);
      const command = {
        type: "claim" as const, expectedRevision, at: new Date().toISOString(),
        workerId: agent.tokenId, runtimeId: runtimeOf(agent), leaseMs: LEASE_MS
      };
      return this.transitions.commitTx(tx, row, command, agent.tokenId, { kind: "manual_mcp" });
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
      const row = await this.transitions.loadTx(tx, agent.workspaceId, executionId);
      await this.transitions.accessibleTx(tx, agent, row);
      const shared = { expectedRevision: input.expectedRevision, at: new Date().toISOString(), workerId: agent.tokenId };
      const command: AgentHubCommand = input.action === "start"
        ? { ...shared, type: "start" }
        : input.action === "heartbeat"
          ? { ...shared, type: "heartbeat", leaseMs: LEASE_MS }
          : input.action === "checkpoint"
            ? { ...shared, type: "checkpoint", checkpointRef: input.checkpointRef }
            : input.action === "submit"
              ? { ...shared, type: "submit", evidenceRefs: input.evidenceRefs, summary: input.summary }
              : input.action === "block"
                ? { ...shared, type: "block", reason: input.reason }
                : { ...shared, type: "fail", reason: input.reason, summary: input.summary };
      const metadata: Record<string, unknown> = {};
      if (input.action === "block" || input.action === "fail") metadata.reason = input.reason;
      if (input.action === "checkpoint") metadata.checkpointRef = input.checkpointRef;
      if (input.action === "submit") metadata.evidenceRefs = input.evidenceRefs;
      if ((input.action === "submit" || input.action === "fail") && input.summary) metadata.summary = input.summary;
      // These are unverified references; they do NOT close the Task automatically.
      return this.transitions.commitTx(tx, row, command, agent.tokenId, metadata);
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
        where: { workspaceId, status: { in: ["claimed", "working", "waiting_approval"] }, leaseUntil: { lte: now } },
        orderBy: { leaseUntil: "asc" }, take: 50
      });
      let recovered = 0;
      for (const row of stale) {
        try {
          await this.transitions.commitTx(tx, row, {
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
