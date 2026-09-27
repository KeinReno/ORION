import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createSavingsGoalInputSchema,
  updateSavingsGoalInputSchema,
  type CreateSavingsGoalInput,
  type SavingsGoal,
  type UpdateSavingsGoalInput
} from "@orion/shared-types";
import { RequireModule } from "../../modules/require-module";
import { CurrentUser } from "../../common/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { RequestUser } from "../../auth/jwt.strategy";
import { GoalsService } from "./goals.service";

@RequireModule("finance")
@Controller("workspaces/:workspaceId/finance/goals")
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("includeArchived") includeArchived?: string
  ): Promise<SavingsGoal[]> {
    return this.goals.list(user.userId, workspaceId, includeArchived === "true");
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createSavingsGoalInputSchema)) body: CreateSavingsGoalInput
  ): Promise<SavingsGoal> {
    return this.goals.create(user.userId, workspaceId, body);
  }

  @Patch(":goalId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("goalId") goalId: string,
    @Body(new ZodValidationPipe(updateSavingsGoalInputSchema)) body: UpdateSavingsGoalInput
  ): Promise<SavingsGoal> {
    return this.goals.update(user.userId, workspaceId, goalId, body);
  }

  @Delete(":goalId")
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("goalId") goalId: string
  ): Promise<void> {
    return this.goals.remove(user.userId, workspaceId, goalId);
  }
}
