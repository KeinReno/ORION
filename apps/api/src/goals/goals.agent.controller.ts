import { Body, Controller, Delete, Get, OnModuleInit, Param, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import {
  addGoalPlanInputSchema,
  agentDeleteRequestSchema,
  createGoalInputSchema,
  updateGoalInputSchema,
  type AddGoalPlanInput,
  type AgentDeleteRequest,
  type CreateGoalInput,
  type Goal
} from "@orion/shared-types";
import type { Response } from "express";
import { AgentModuleToolsService, type ModuleChangeResult } from "../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { GoalsService } from "./goals.service";

const goalChangeSchema = updateGoalInputSchema.pick({ title: true, description: true, status: true, dueAt: true });

/**
 * Инструменты ИИ-агента для целей (плагин «Глобальные цели» модуля «Проекты», G13). Прогресс цели агент не задаёт — он
 * считается по задачам проектов-планов. Разрешение, режим, лимит и журнал — в `AgentModuleToolsService`.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/goals")
export class GoalsAgentController implements OnModuleInit {
  constructor(
    private readonly goals: GoalsService,
    private readonly tools: AgentModuleToolsService
  ) {}

  onModuleInit(): void {
    const describe = async (userId: string, workspaceId: string, goalId: string) => {
      const goal = (await this.goals.list(userId, workspaceId)).find((item) => item.id === goalId);
      return goal
        ? { title: goal.title, fields: { title: goal.title, description: goal.description, status: goal.status, dueAt: goal.dueAt }, labels: { title: "Название", description: "Описание", status: "Статус", dueAt: "Срок" } }
        : null;
    };
    this.tools.register("orion_goals_update", {
      noun: "цель",
      describe,
      apply: (userId, workspaceId, goalId, args) => this.goals.update(userId, workspaceId, goalId, goalChangeSchema.parse(args))
    });
    this.tools.register("orion_goals_delete", { noun: "цель", describe, apply: (userId, workspaceId, goalId) => this.goals.remove(userId, workspaceId, goalId) });
  }

  @Get()
  list(@Req() req: AgentRequest): Promise<Goal[]> {
    return this.tools.run(req, "orion_goals_list", (agent) => this.goals.list(agent.userId, agent.workspaceId));
  }

  @Post()
  create(@Req() req: AgentRequest, @Body(new ZodValidationPipe(createGoalInputSchema)) body: CreateGoalInput): Promise<Goal> {
    return this.tools.run(
      req,
      "orion_goals_create",
      (agent) => this.goals.create(agent.userId, agent.workspaceId, body),
      (goal) => ({ resource: `goal:${goal.id}`, objectType: "goal", objectId: goal.id, summary: `Создал цель «${goal.title}»` })
    );
  }

  @Patch(":goalId")
  update(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("goalId") goalId: string,
    @Body(new ZodValidationPipe(goalChangeSchema)) body: Record<string, unknown>
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_goals_update", goalId, body);
  }

  @Post(":goalId/plans")
  addProject(
    @Req() req: AgentRequest,
    @Param("goalId") goalId: string,
    @Body(new ZodValidationPipe(addGoalPlanInputSchema)) body: AddGoalPlanInput
  ): Promise<Goal> {
    return this.tools.run(
      req,
      "orion_goals_add_project",
      (agent) => this.goals.addPlan(agent.userId, agent.workspaceId, goalId, body),
      (goal) => ({ resource: `goal:${goal.id}`, objectType: "goal", objectId: goal.id, summary: `Привязал проект к цели «${goal.title}»` })
    );
  }

  /** The goal only: its linked projects stay as they are. */
  @Delete(":goalId")
  remove(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("goalId") goalId: string,
    @Body(new ZodValidationPipe(agentDeleteRequestSchema)) body: AgentDeleteRequest
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_goals_delete", goalId, {}, { reason: body.reason });
  }
}
