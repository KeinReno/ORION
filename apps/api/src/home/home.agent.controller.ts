import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { createMeterReadingInputSchema, type CreateMeterReadingInput, type Home, type HomeOverview, type Meter } from "@orion/shared-types";
import { AgentModuleToolsService } from "../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { HomeService } from "./home.service";

/**
 * Инструменты ИИ-агента для модуля «Дом» (G13): обзор домов и показания счётчиков. Разрешение, режим, включённость модуля,
 * лимит записи и журнал — в `AgentModuleToolsService`; здесь только вызов сервиса от имени человека-владельца токена.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/home")
export class HomeAgentController {
  constructor(
    private readonly homes: HomeService,
    private readonly tools: AgentModuleToolsService
  ) {}

  @Get()
  list(@Req() req: AgentRequest): Promise<Array<{ home: Home; overview: HomeOverview }>> {
    return this.tools.run(req, "orion_home_list", async (agent) => {
      const homes = await this.homes.list(agent.userId, agent.workspaceId);
      return Promise.all(homes.map(async (home) => ({ home, overview: await this.homes.overview(agent.userId, agent.workspaceId, home.id) })));
    });
  }

  @Post(":homeId/meters/:meterId/readings")
  addReading(
    @Req() req: AgentRequest,
    @Param("homeId") homeId: string,
    @Param("meterId") meterId: string,
    @Body(new ZodValidationPipe(createMeterReadingInputSchema)) body: CreateMeterReadingInput
  ): Promise<Meter> {
    return this.tools.run(
      req,
      "orion_home_add_reading",
      (agent) => this.homes.addReading(agent.userId, agent.workspaceId, homeId, meterId, body),
      (meter) => ({ resource: `meter:${meter.id}`, summary: `Внёс показание «${meter.name}»: ${body.value}` })
    );
  }
}
