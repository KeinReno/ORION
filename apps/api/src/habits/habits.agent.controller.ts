import { Body, Controller, Delete, Get, HttpCode, NotFoundException, OnModuleInit, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import {
  agentDeleteRequestSchema,
  agentHabitMarkDoneInputSchema,
  agentHabitsListQuerySchema,
  createHabitInputSchema,
  updateHabitInputSchema,
  type AgentDeleteRequest,
  type AgentHabitMarkDoneInput,
  type AgentHabitsListQuery,
  type CreateHabitInput,
  type Habit,
  type ToggleHabitResult,
  type UpdateHabitInput
} from "@orion/shared-types";
import type { Response } from "express";
import { AgentModuleToolsService, type ModuleChangeResult } from "../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { HabitsService } from "./habits.service";

const habitChangeSchema = updateHabitInputSchema.pick({ name: true, note: true, weekdays: true });

/**
 * Инструменты ИИ-агента для модуля «Привычки» (G13, каталог — `AGENT_TOOLS` в shared-types). Разрешение, режим, включённость
 * модуля, лимит записи и журнал — в `AgentModuleToolsService`; здесь только вызов сервиса от имени человека-владельца токена.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/habits")
export class HabitsAgentController implements OnModuleInit {
  constructor(
    private readonly habits: HabitsService,
    private readonly tools: AgentModuleToolsService
  ) {}

  onModuleInit(): void {
    const describe = async (userId: string, workspaceId: string, habitId: string) => {
      const habit = (await this.habits.list(userId, workspaceId, { includeArchived: true })).find((item) => item.id === habitId);
      return habit ? { title: habit.name, fields: { name: habit.name, note: habit.note, weekdays: habit.weekdays }, labels: { name: "Название", note: "Заметка", weekdays: "Дни недели" } } : null;
    };
    this.tools.register("orion_habits_update", {
      noun: "привычка",
      describe,
      apply: (userId, workspaceId, habitId, args) => this.habits.update(userId, workspaceId, habitId, habitChangeSchema.parse(args) as UpdateHabitInput)
    });
    this.tools.register("orion_habits_archive", { noun: "привычка", describe, apply: (userId, workspaceId, habitId) => this.habits.archive(userId, workspaceId, habitId) });
  }

  @Get()
  list(@Req() req: AgentRequest, @Query(new ZodValidationPipe(agentHabitsListQuerySchema)) query: AgentHabitsListQuery): Promise<Habit[]> {
    return this.tools.run(req, "orion_habits_list", (agent) => this.habits.list(agent.userId, agent.workspaceId, { today: query.today }));
  }

  @Post()
  create(@Req() req: AgentRequest, @Body(new ZodValidationPipe(createHabitInputSchema)) body: CreateHabitInput): Promise<Habit> {
    return this.tools.run(
      req,
      "orion_habits_create",
      (agent) => this.habits.create(agent.userId, agent.workspaceId, body),
      (habit) => ({ resource: `habit:${habit.id}`, objectType: "habit", objectId: habit.id, summary: `Создал привычку «${habit.name}»` })
    );
  }

  @Patch(":habitId")
  update(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("habitId") habitId: string,
    @Body(new ZodValidationPipe(habitChangeSchema)) body: Record<string, unknown>
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_habits_update", habitId, body);
  }

  @Delete(":habitId")
  archive(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("habitId") habitId: string,
    @Body(new ZodValidationPipe(agentDeleteRequestSchema)) body: AgentDeleteRequest
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_habits_archive", habitId, {}, { reason: body.reason });
  }

  /** «Отметить выполненной»: toggle only when not done yet — the agent never takes a mark back. */
  @Post(":habitId/done")
  @HttpCode(200)
  markDone(
    @Req() req: AgentRequest,
    @Param("habitId") habitId: string,
    @Body(new ZodValidationPipe(agentHabitMarkDoneInputSchema)) body: AgentHabitMarkDoneInput
  ): Promise<ToggleHabitResult & { name: string }> {
    return this.tools.run(
      req,
      "orion_habits_mark_done",
      async (agent) => {
        const habit = (await this.habits.list(agent.userId, agent.workspaceId, { today: body.day })).find((item) => item.id === habitId);
        if (!habit) throw new NotFoundException("Привычка не найдена");
        if (habit.doneToday) return { habitId, day: body.day ?? "", done: true, name: habit.name };
        const result = await this.habits.toggle(agent.userId, agent.workspaceId, habitId, { day: body.day });
        return { ...result, name: habit.name };
      },
      (result) => ({ resource: `habit:${habitId}`, objectType: "habit", objectId: habitId, summary: `Отметил привычку «${result.name}»` })
    );
  }
}
