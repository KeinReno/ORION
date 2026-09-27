import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createFinanceCategoryInputSchema,
  updateFinanceCategoryInputSchema,
  type CreateFinanceCategoryInput,
  type FinanceCategory,
  type UpdateFinanceCategoryInput
} from "@orion/shared-types";
import { RequireModule } from "../../modules/require-module";
import { CurrentUser } from "../../common/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { RequestUser } from "../../auth/jwt.strategy";
import { CategoriesService } from "./categories.service";

@RequireModule("finance")
@Controller("workspaces/:workspaceId/finance/categories")
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("includeArchived") includeArchived?: string
  ): Promise<FinanceCategory[]> {
    return this.categories.list(user.userId, workspaceId, includeArchived === "true");
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createFinanceCategoryInputSchema)) body: CreateFinanceCategoryInput
  ): Promise<FinanceCategory> {
    return this.categories.create(user.userId, workspaceId, body);
  }

  @Patch(":categoryId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("categoryId") categoryId: string,
    @Body(new ZodValidationPipe(updateFinanceCategoryInputSchema)) body: UpdateFinanceCategoryInput
  ): Promise<FinanceCategory> {
    return this.categories.update(user.userId, workspaceId, categoryId, body);
  }

  @Delete(":categoryId")
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("categoryId") categoryId: string
  ): Promise<void> {
    return this.categories.remove(user.userId, workspaceId, categoryId);
  }
}
