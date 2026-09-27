import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import {
  createCategoryRuleInputSchema,
  type CategoryRule,
  type CreateCategoryRuleInput
} from "@orion/shared-types";
import { RequireModule } from "../../modules/require-module";
import { CurrentUser } from "../../common/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { RequestUser } from "../../auth/jwt.strategy";
import { CategoryRulesService } from "./category-rules.service";

@RequireModule("finance")
@Controller("workspaces/:workspaceId/finance/category-rules")
export class CategoryRulesController {
  constructor(private readonly rules: CategoryRulesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<CategoryRule[]> {
    return this.rules.list(user.userId, workspaceId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createCategoryRuleInputSchema)) body: CreateCategoryRuleInput
  ): Promise<CategoryRule> {
    return this.rules.create(user.userId, workspaceId, body);
  }

  @Delete(":ruleId")
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("ruleId") ruleId: string
  ): Promise<void> {
    return this.rules.remove(user.userId, workspaceId, ruleId);
  }
}
