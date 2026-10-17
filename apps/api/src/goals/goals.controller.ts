import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  addGoalPlanInputSchema,
  createGoalInputSchema,
  updateGoalInputSchema,
  updateGoalPlanInputSchema,
  type AddGoalPlanInput,
  type CreateGoalInput,
  type Goal,
  type GoalHistory,
  type UpdateGoalInput,
  type UpdateGoalPlanInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequireModule } from "../modules/require-module";
import { RequirePlugin } from "../plugins/require-plugin";
import { GoalsService } from "./goals.service";

@RequireModule("projects")
@RequirePlugin("projects-goals")
@Controller("workspaces/:workspaceId/goals")
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<Goal[]> {
    return this.goals.list(user.userId, workspaceId);
  }

  @Get("history")
  history(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("weeks") weeks?: string
  ): Promise<GoalHistory> {
    return this.goals.history(user.userId, workspaceId, Number(weeks) || 12);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createGoalInputSchema)) body: CreateGoalInput
  ): Promise<Goal> {
    return this.goals.create(user.userId, workspaceId, body);
  }

  @Patch(":goalId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("goalId") goalId: string,
    @Body(new ZodValidationPipe(updateGoalInputSchema)) body: UpdateGoalInput
  ): Promise<Goal> {
    return this.goals.update(user.userId, workspaceId, goalId, body);
  }

  @Delete(":goalId")
  @HttpCode(204)
  remove(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("goalId") goalId: string): Promise<void> {
    return this.goals.remove(user.userId, workspaceId, goalId);
  }

  @Post(":goalId/plans")
  addPlan(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("goalId") goalId: string,
    @Body(new ZodValidationPipe(addGoalPlanInputSchema)) body: AddGoalPlanInput
  ): Promise<Goal> {
    return this.goals.addPlan(user.userId, workspaceId, goalId, body);
  }

  @Patch(":goalId/plans/:planId")
  updatePlan(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("goalId") goalId: string,
    @Param("planId") planId: string,
    @Body(new ZodValidationPipe(updateGoalPlanInputSchema)) body: UpdateGoalPlanInput
  ): Promise<Goal> {
    return this.goals.updatePlan(user.userId, workspaceId, goalId, planId, body);
  }

  @Delete(":goalId/plans/:planId")
  removePlan(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("goalId") goalId: string,
    @Param("planId") planId: string
  ): Promise<Goal> {
    return this.goals.removePlan(user.userId, workspaceId, goalId, planId);
  }
}
