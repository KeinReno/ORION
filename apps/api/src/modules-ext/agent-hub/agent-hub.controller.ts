import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import {
  agentHubCreateExecutionInputSchema, agentHubCancelInputSchema,
  type AgentHubCreateExecutionInput, type AgentHubCancelInput,
  type AgentHubExecution, type AgentHubEvent
} from "@orion/shared-types";
import type { RequestUser } from "../../auth/jwt.strategy";
import { CurrentUser } from "../../common/current-user.decorator";
import { RequirePermission } from "../../common/require-permission";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { RequireModule } from "../../modules/require-module";
import { AgentHubService } from "./agent-hub.service";

/** Human routes only. Autonomous claim/heartbeat are intentionally NOT exposed. */
@RequireModule("agent-hub")
@Controller("workspaces/:workspaceId/agent-hub")
export class AgentHubController {
  constructor(private readonly hub: AgentHubService) {}

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
