import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  agentPeriodQuerySchema,
  createTimeEntryInputSchema,
  defaultAgentPeriod,
  startTimerInputSchema,
  stopTimerInputSchema,
  type AgentPeriodQuery,
  type CreateTimeEntryInput,
  type StartTimerInput,
  type StopTimerInput,
  type TimeEntry,
  type TimeSummary
} from "@orion/shared-types";
import { AgentModuleToolsService } from "../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { TimeService } from "./time.service";

/**
 * Инструменты ИИ-агента для модуля «Учёт времени» (G13, каталог — `AGENT_TOOLS` в shared-types). Разрешение, режим,
 * включённость модуля, лимит записи и журнал — в `AgentModuleToolsService`; таймер — человека-владельца токена.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/time")
export class TimeAgentController {
  constructor(
    private readonly time: TimeService,
    private readonly tools: AgentModuleToolsService
  ) {}

  @Get("summary")
  summary(
    @Req() req: AgentRequest,
    @Query(new ZodValidationPipe(agentPeriodQuerySchema)) query: AgentPeriodQuery
  ): Promise<{ from: string; to: string; summary: TimeSummary; running: TimeEntry | null }> {
    return this.tools.run(req, "orion_time_summary", async (agent) => {
      const period = { ...defaultAgentPeriod(), ...query };
      const [summary, running] = await Promise.all([
        this.time.summary(agent.userId, agent.workspaceId, period),
        this.time.running(agent.userId, agent.workspaceId)
      ]);
      return { ...period, summary, running };
    });
  }

  @Post("start")
  start(@Req() req: AgentRequest, @Body(new ZodValidationPipe(startTimerInputSchema)) body: StartTimerInput): Promise<TimeEntry> {
    return this.tools.run(
      req,
      "orion_time_start",
      (agent) => this.time.start(agent.userId, agent.workspaceId, body),
      (entry) => ({ resource: `time:${entry.id}`, summary: "Запустил таймер" })
    );
  }

  @Post("stop")
  @HttpCode(200)
  stop(@Req() req: AgentRequest, @Body(new ZodValidationPipe(stopTimerInputSchema)) body: StopTimerInput): Promise<TimeEntry> {
    return this.tools.run(
      req,
      "orion_time_stop",
      (agent) => this.time.stop(agent.userId, agent.workspaceId, body),
      (entry) => ({ resource: `time:${entry.id}`, summary: `Остановил таймер: ${entry.minutes} мин` })
    );
  }

  @Post("entries")
  addEntry(@Req() req: AgentRequest, @Body(new ZodValidationPipe(createTimeEntryInputSchema)) body: CreateTimeEntryInput): Promise<TimeEntry> {
    return this.tools.run(
      req,
      "orion_time_add_entry",
      (agent) => this.time.create(agent.userId, agent.workspaceId, body),
      (entry) => ({ resource: `time:${entry.id}`, summary: `Записал время: ${entry.minutes} мин` })
    );
  }
}
