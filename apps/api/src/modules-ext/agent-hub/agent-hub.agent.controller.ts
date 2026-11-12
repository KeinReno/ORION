import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  agentHubClaimInputSchema, agentHubReportInputSchema, type AgentHubClaimInput,
  type AgentHubReportInput, type AgentHubExecution,
  agentHubRuntimeRegisterSchema, agentHubRuntimePulseSchema,
  type AgentHubRuntimeRegisterInput, type AgentHubRuntimePulseInput, type AgentHubRuntimeSession,
  agentHubDelegateInputSchema, type AgentHubDelegateInput, type AgentHubDelegationResult,
  agentHubApprovalRequestInputSchema, type AgentHubApprovalRequestInput,
  agentHubTraceRecordInputSchema, type AgentHubTraceRecordInput, type AgentHubTraceStep,
  agentMemoryWriteInputSchema, agentMemoryReadQuerySchema, type AgentMemoryWriteInput,
  type AgentMemoryReadQuery, type AgentMemoryRecord,
  agentHubContextQuerySchema, type AgentHubContextQuery, type AgentHubContextResponse
} from "@orion/shared-types";
import { AgentModuleToolsService } from "../../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../../ai/agent-token.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AgentHubRuntimeRegistryService } from "./agent-hub-runtime-registry.service";
import { AgentHubWorkerService } from "./agent-hub-worker.service";
import { AgentHubDelegationService } from "./agent-hub-delegation.service";
import { AgentHubTraceService } from "./agent-hub-trace.service";
import { AgentHubMemoryService } from "./agent-hub-memory.service";

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
    private readonly runtimes: AgentHubRuntimeRegistryService,
    private readonly delegation: AgentHubDelegationService,
    private readonly traceService: AgentHubTraceService,
    private readonly memory: AgentHubMemoryService
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

  @Post("executions/:executionId/delegate")
  delegate(
    @Req() request: AgentRequest,
    @Param("executionId") executionId: string,
    @Body(new ZodValidationPipe(agentHubDelegateInputSchema)) body: AgentHubDelegateInput
  ): Promise<AgentHubDelegationResult> {
    return this.tools.run(request, "orion_agent_hub_delegate",
      agent => this.delegation.delegate(agent, executionId, body),
      result => ({ resource: `agent-hub:${result.execution.id}`, objectType: "agent-hub-execution", objectId: result.execution.id })
    );
  }

  @Post("executions/:executionId/request-approval")
  requestApproval(
    @Req() request: AgentRequest,
    @Param("executionId") executionId: string,
    @Body(new ZodValidationPipe(agentHubApprovalRequestInputSchema)) body: AgentHubApprovalRequestInput
  ): Promise<AgentHubExecution> {
    return this.tools.run(request, "orion_agent_hub_request_approval",
      agent => this.delegation.requestApproval(agent, executionId, body),
      result => ({ resource: `agent-hub:${result.id}`, objectType: "agent-hub-execution", objectId: result.id })
    );
  }

  @Post("executions/:executionId/trace")
  recordStep(
    @Req() request: AgentRequest,
    @Param("executionId") executionId: string,
    @Body(new ZodValidationPipe(agentHubTraceRecordInputSchema)) body: AgentHubTraceRecordInput
  ): Promise<AgentHubTraceStep> {
    return this.tools.run(request, "orion_agent_hub_trace_record",
      agent => this.traceService.record(agent, executionId, body),
      step => ({ resource: `agent-hub:${step.executionId}`, objectType: "agent-hub-trace-step", objectId: step.id })
    );
  }

  @Post("memory")
  memoryWrite(
    @Req() request: AgentRequest,
    @Body(new ZodValidationPipe(agentMemoryWriteInputSchema)) body: AgentMemoryWriteInput
  ): Promise<AgentMemoryRecord> {
    return this.tools.run(request, "orion_agent_hub_memory_write",
      agent => this.memory.writeAsAgent(agent, body),
      record => ({ resource: `agent-memory:${record.id}`, objectType: "agent-memory", objectId: record.id })
    );
  }

  @Get("memory")
  memoryRead(
    @Req() request: AgentRequest,
    @Query(new ZodValidationPipe(agentMemoryReadQuerySchema)) query: AgentMemoryReadQuery
  ): Promise<AgentMemoryRecord[]> {
    return this.tools.run(request, "orion_agent_hub_memory_read", agent => this.memory.listAsAgent(agent, query));
  }

  @Get("context")
  context(
    @Req() request: AgentRequest,
    @Query(new ZodValidationPipe(agentHubContextQuerySchema)) query: AgentHubContextQuery
  ): Promise<AgentHubContextResponse> {
    return this.tools.run(request, "orion_agent_hub_context", agent => this.memory.contextForAgent(agent, query));
  }
}
