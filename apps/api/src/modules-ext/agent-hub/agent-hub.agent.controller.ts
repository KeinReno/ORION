import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import {
  agentHubClaimInputSchema, agentHubReportInputSchema, type AgentHubClaimInput,
  type AgentHubReportInput, type AgentHubExecution,
  agentHubRuntimeRegisterSchema, agentHubRuntimePulseSchema,
  type AgentHubRuntimeRegisterInput, type AgentHubRuntimePulseInput, type AgentHubRuntimeSession
} from "@orion/shared-types";
import { AgentModuleToolsService } from "../../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../../ai/agent-token.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AgentHubRuntimeRegistryService } from "./agent-hub-runtime-registry.service";
import { AgentHubWorkerService } from "./agent-hub-worker.service";

/**
 * Manual MCP worker tools. Requests are never authorized by caller-supplied
 * workerId, runtimeId, workspaceId, timestamp or model name.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/agent-hub")
export class AgentHubAgentController {
  constructor(
    private readonly workers: AgentHubWorkerService,
    private readonly tools: AgentModuleToolsService,
    private readonly runtimes: AgentHubRuntimeRegistryService
  ) {}

  @Post("runtime-sessions")
  registerRuntime(
    @Req() request: AgentRequest,
    @Body(new ZodValidationPipe(agentHubRuntimeRegisterSchema)) body: AgentHubRuntimeRegisterInput
  ): Promise<AgentHubRuntimeSession> {
    return this.tools.run(request, "orion_agent_hub_runtime_register",
      agent => this.runtimes.register(agent, body),
      session => ({ resource: `agent-hub-runtime:${session.id}`, objectType: "runtime-session", objectId: session.id })
    );
  }

  @Post("runtime-sessions/:sessionId/pulse")
  runtimePulse(
    @Req() request: AgentRequest, @Param("sessionId") sessionId: string,
    @Body(new ZodValidationPipe(agentHubRuntimePulseSchema)) body: AgentHubRuntimePulseInput
  ): Promise<AgentHubRuntimeSession> {
    return this.tools.run(request, "orion_agent_hub_runtime_pulse",
      agent => this.runtimes.pulse(agent, sessionId, body.expectedRevision),
      session => ({ resource: `agent-hub-runtime:${session.id}`, objectType: "runtime-session", objectId: session.id })
    );
  }

  @Post("runtime-sessions/:sessionId/close")
  runtimeClose(
    @Req() request: AgentRequest, @Param("sessionId") sessionId: string,
    @Body(new ZodValidationPipe(agentHubRuntimePulseSchema)) body: AgentHubRuntimePulseInput
  ): Promise<AgentHubRuntimeSession> {
    return this.tools.run(request, "orion_agent_hub_runtime_close",
      agent => this.runtimes.close(agent, sessionId, body.expectedRevision),
      session => ({ resource: `agent-hub-runtime:${session.id}`, objectType: "runtime-session", objectId: session.id })
    );
  }

  @Get("executions")
  queue(@Req() request: AgentRequest): Promise<AgentHubExecution[]> {
    return this.tools.run(request, "orion_agent_hub_queue", agent => this.workers.queue(agent));
  }

  @Post("executions/:executionId/claim")
  claim(
    @Req() request: AgentRequest,
    @Param("executionId") executionId: string,
    @Body(new ZodValidationPipe(agentHubClaimInputSchema)) body: AgentHubClaimInput
  ): Promise<AgentHubExecution> {
    return this.tools.run(request, "orion_agent_hub_claim",
      agent => this.workers.claim(agent, executionId, body.expectedRevision),
      result => ({ resource: `agent-hub:${result.id}`, objectType: "agent-hub-execution", objectId: result.id })
    );
  }

  @Post("executions/:executionId/report")
  report(
    @Req() request: AgentRequest,
    @Param("executionId") executionId: string,
    @Body(new ZodValidationPipe(agentHubReportInputSchema)) body: AgentHubReportInput
  ): Promise<AgentHubExecution> {
    return this.tools.run(request, "orion_agent_hub_report",
      agent => this.workers.report(agent, executionId, body),
      result => ({ resource: `agent-hub:${result.id}`, objectType: "agent-hub-execution", objectId: result.id })
    );
  }
}
