import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createBudgetInputSchema,
  updateBudgetInputSchema,
  type Budget,
  type CreateBudgetInput,
  type UpdateBudgetInput
} from "@orion/shared-types";
import { RequireModule } from "../../modules/require-module";
import { CurrentUser } from "../../common/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { RequestUser } from "../../auth/jwt.strategy";
import { RequirePlugin } from "../../plugins/require-plugin";
import { BudgetsService } from "./budgets.service";

@RequireModule("finance")
@RequirePlugin("finance-budgeting")
@Controller("workspaces/:workspaceId/finance/budgets")
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("month") month?: string
  ): Promise<Budget[]> {
    return this.budgets.list(user.userId, workspaceId, month);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createBudgetInputSchema)) body: CreateBudgetInput
  ): Promise<Budget> {
    return this.budgets.create(user.userId, workspaceId, body);
  }

  @Patch(":budgetId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("budgetId") budgetId: string,
    @Body(new ZodValidationPipe(updateBudgetInputSchema)) body: UpdateBudgetInput
  ): Promise<Budget> {
    return this.budgets.update(user.userId, workspaceId, budgetId, body);
  }

  @Delete(":budgetId")
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("budgetId") budgetId: string
  ): Promise<void> {
    return this.budgets.remove(user.userId, workspaceId, budgetId);
  }
}
