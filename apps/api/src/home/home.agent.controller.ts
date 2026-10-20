import { Body, Controller, Delete, Get, OnModuleInit, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import {
  agentDeleteRequestSchema,
  createMeterReadingInputSchema,
  type AgentDeleteRequest,
  type CreateMeterReadingInput,
  type Home,
  type HomeOverview,
  type Meter
} from "@orion/shared-types";
import type { Response } from "express";
import { AgentModuleToolsService, type ModuleChangeResult } from "../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { HomeService } from "./home.service";

/** A nested record is addressed as `<parentId>:<id>` (or more parts) in requests: the service needs every id. */
const splitKey = (key: string): string[] => key.split(":");

/**
 * Инструменты ИИ-агента для модуля «Дом» (G13): обзор домов и показания счётчиков. Разрешение, режим, включённость модуля,
 * лимит записи и журнал — в `AgentModuleToolsService`; здесь только вызов сервиса от имени человека-владельца токена.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/home")
export class HomeAgentController implements OnModuleInit {
  constructor(
    private readonly homes: HomeService,
    private readonly tools: AgentModuleToolsService
  ) {}

  onModuleInit(): void {
    const meterOf = async (userId: string, workspaceId: string, homeId: string, meterId: string): Promise<Meter | undefined> =>
      (await this.homes.overview(userId, workspaceId, homeId).catch(() => null))?.meters.find((meter) => meter.id === meterId);
    this.tools.register("orion_home_delete_reading", {
      noun: "показание",
      describe: async (userId, workspaceId, key) => {
        const [homeId, meterId, readingId] = splitKey(key);
        const meter = await meterOf(userId, workspaceId, homeId, meterId);
        const reading = meter?.readings.find((entry) => entry.id === readingId);
        return meter && reading
          ? {
              title: `${meter.name}: ${reading.value} ${meter.unit} (${reading.readAt.slice(0, 10)})`,
              fields: { value: reading.value, readAt: reading.readAt, note: reading.note },
              labels: { value: "Значение", readAt: "Когда", note: "Заметка" }
            }
          : null;
      },
      apply: async (userId, workspaceId, key) => {
        const [homeId, meterId, readingId] = splitKey(key);
        await this.homes.removeReading(userId, workspaceId, homeId, meterId, readingId);
      }
    });
    this.tools.register("orion_home_delete_meter", {
      noun: "счётчик",
      describe: async (userId, workspaceId, key) => {
        const [homeId, meterId] = splitKey(key);
        const meter = await meterOf(userId, workspaceId, homeId, meterId);
        return meter
          ? { title: meter.name, fields: { name: meter.name, unit: meter.unit, lastValue: meter.lastValue }, labels: { name: "Счётчик", unit: "Единица", lastValue: "Последнее показание" } }
          : null;
      },
      apply: (userId, workspaceId, key) => {
        const [homeId, meterId] = splitKey(key);
        return this.homes.removeMeter(userId, workspaceId, homeId, meterId);
      }
    });
  }

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

  @Delete(":homeId/meters/:meterId/readings/:readingId")
  deleteReading(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("homeId") homeId: string,
    @Param("meterId") meterId: string,
    @Param("readingId") readingId: string,
    @Body(new ZodValidationPipe(agentDeleteRequestSchema)) body: AgentDeleteRequest
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_home_delete_reading", `${homeId}:${meterId}:${readingId}`, {}, { reason: body.reason });
  }

  /** The meter with all its readings. */
  @Delete(":homeId/meters/:meterId")
  deleteMeter(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("homeId") homeId: string,
    @Param("meterId") meterId: string,
    @Body(new ZodValidationPipe(agentDeleteRequestSchema)) body: AgentDeleteRequest
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_home_delete_meter", `${homeId}:${meterId}`, {}, { reason: body.reason });
  }
}
