import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  agentHabitMarkDoneInputSchema,
  agentHabitsListQuerySchema,
  type AgentHabitMarkDoneInput,
  type AgentHabitsListQuery,
  type Habit,
  type ToggleHabitResult
} from "@orion/shared-types";
import { AgentModuleToolsService } from "../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { HabitsService } from "./habits.service";

/**
 * Инструменты ИИ-агента для модуля «Привычки» (G13, каталог — `AGENT_TOOLS` в shared-types). Разрешение, режим, включённость
 * модуля, лимит записи и журнал — в `AgentModuleToolsService`; здесь только вызов сервиса от имени человека-владельца токена.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/habits")
export class HabitsAgentController {
  constructor(
    private readonly habits: HabitsService,
    private readonly tools: AgentModuleToolsService
  ) {}

  @Get()
  list(@Req() req: AgentRequest, @Query(new ZodValidationPipe(agentHabitsListQuerySchema)) query: AgentHabitsListQuery): Promise<Habit[]> {
    return this.tools.run(req, "orion_habits_list", (agent) => this.habits.list(agent.userId, agent.workspaceId, { today: query.today }));
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
