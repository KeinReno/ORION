import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import {
  agentHubCreateExecutionInputSchema, agentHubCancelInputSchema,
  type AgentHubCreateExecutionInput, type AgentHubCancelInput,
  type AgentHubExecution, type AgentHubEvent, type AgentHubRuntimeSession,
  agentHubCreateAgentProfileInputSchema, agentHubSetTaskAssignmentInputSchema, agentHubBindAgentCredentialsInputSchema,
  type AgentHubCreateAgentProfileInput, type AgentHubSetTaskAssignmentInput, type AgentHubBindAgentCredentialsInput,
  type AgentHubAgentProfile, type AgentHubTaskAssignment, type AgentHubCredentialOption
} from "@orion/shared-types";
import type { RequestUser } from "../../auth/jwt.strategy";
import { CurrentUser } from "../../common/current-user.decorator";
import { RequirePermission } from "../../common/require-permission";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { RequireModule } from "../../modules/require-module";
import { AgentHubRuntimeRegistryService } from "./agent-hub-runtime-registry.service";
import { AgentHubWorkerService } from "./agent-hub-worker.service";
import { AgentHubService } from "./agent-hub.service";
import { AgentHubAssignmentService } from "./agent-hub-assignment.service";

/** Human routes only. Autonomous claim/heartbeat are intentionally NOT exposed. */
@RequireModule("agent-hub")
@Controller("workspaces/:workspaceId/agent-hub")
export class AgentHubController {
  constructor(private readonly hub: AgentHubService, private readonly workers: AgentHubWorkerService, private readonly runtimes: AgentHubRuntimeRegistryService, private readonly assignments: AgentHubAssignmentService) {}

  @Get("agents")
  @RequirePermission("agent-hub.execution.read")
  agents(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<{ agents: AgentHubAgentProfile[] }> {
    return this.assignments.agentsFor(user.userId, workspaceId);
  }

  @Get("agent-credentials")
  @RequirePermission("agent-hub.execution.read")
  credentials(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<{ credentials: AgentHubCredentialOption[] }> {
    return this.assignments.credentialsFor(user.userId, workspaceId);
  }

  @Post("agents")
  @RequirePermission("agent-hub.execution.create")
  createAgent(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(agentHubCreateAgentProfileInputSchema)) body: AgentHubCreateAgentProfileInput): Promise<AgentHubAgentProfile> {
    return this.assignments.createAgent(user.userId, workspaceId, body);
  }

  @Put("agents/:agentId/credentials")
  @RequirePermission("agent-hub.execution.update")
  rebindAgent(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("agentId") agentId: string,
    @Body(new ZodValidationPipe(agentHubBindAgentCredentialsInputSchema)) body: AgentHubBindAgentCredentialsInput): Promise<AgentHubAgentProfile> {
    return this.assignments.rebindAgent(user.userId, workspaceId, agentId, body);
  }

  @Get("task-assignments/:taskId")
  @RequirePermission("agent-hub.execution.read")
  getTaskAssignment(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("taskId") taskId: string): Promise<AgentHubTaskAssignment> {
    return this.assignments.getAssignment(user.userId, workspaceId, taskId);
  }

  @Put("task-assignments/:taskId")
  @RequirePermission("agent-hub.execution.update")
  setTaskAssignment(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("taskId") taskId: string,
    @Body(new ZodValidationPipe(agentHubSetTaskAssignmentInputSchema)) body: AgentHubSetTaskAssignmentInput): Promise<AgentHubTaskAssignment> {
    return this.assignments.setAssignment(user.userId, workspaceId, taskId, body.agentId);
  }

  /** Server-side lease expiration; only human owner/lead can invoke it. */
  @Post("reconcile")
  @RequirePermission("agent-hub.execution.update")
  reconcile(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<{ recovered: number }> {
    return this.workers.reconcileExpired(user.userId, workspaceId);
  }

  @Get("runtime-sessions")
  @RequirePermission("agent-hub.execution.read")
  runtimeSessions(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<AgentHubRuntimeSession[]> {
    return this.runtimes.list(user.userId, workspaceId);
  }

  @Get("executions")
  @RequirePermission("agent-hub.execution.read")
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<AgentHubExecution[]> {
    return this.hub.list(user.userId, workspaceId);
  }

  @Get("executions/:executionId")
  @RequirePermission("agent-hub.execution.read")
  get(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("executionId") executionId: string): Promise<AgentHubExecution> {
    return this.hub.get(user.userId, workspaceId, executionId);
  }

  @Get("executions/:executionId/events")
  @RequirePermission("agent-hub.execution.read")
  events(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("executionId") executionId: string): Promise<AgentHubEvent[]> {
    return this.hub.events(user.userId, workspaceId, executionId);
  }

  @Post("executions")
  @RequirePermission("agent-hub.execution.create")
  create(
    @CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(agentHubCreateExecutionInputSchema)) body: AgentHubCreateExecutionInput
  ): Promise<AgentHubExecution> {
    return this.hub.create(user.userId, workspaceId, body);
  }

  @Post("executions/:executionId/cancel")
  @RequirePermission("agent-hub.execution.update")
  cancel(
    @CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string,
    @Param("executionId") executionId: string,
    @Body(new ZodValidationPipe(agentHubCancelInputSchema)) body: AgentHubCancelInput
  ): Promise<AgentHubExecution> {
    return this.hub.cancel(user.userId, workspaceId, executionId, body.expectedRevision);
  }
}
