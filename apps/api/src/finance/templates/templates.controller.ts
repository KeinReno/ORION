import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import {
  createFinanceTemplateInputSchema,
  updateFinanceTemplateInputSchema,
  type CreateFinanceTemplateInput,
  type FinanceTemplate,
  type UpdateFinanceTemplateInput
} from "@orion/shared-types";
import { RequireModule } from "../../modules/require-module";
import { CurrentUser } from "../../common/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { RequestUser } from "../../auth/jwt.strategy";
import { RequirePlugin } from "../../plugins/require-plugin";
import { TemplatesService } from "./templates.service";

@RequireModule("finance")
@RequirePlugin("finance-templates")
@Controller("workspaces/:workspaceId/finance/templates")
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<FinanceTemplate[]> {
    return this.templates.list(user.userId, workspaceId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createFinanceTemplateInputSchema)) body: CreateFinanceTemplateInput
  ): Promise<FinanceTemplate> {
    return this.templates.create(user.userId, workspaceId, body);
  }

  @Patch(":templateId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("templateId") templateId: string,
    @Body(new ZodValidationPipe(updateFinanceTemplateInputSchema)) body: UpdateFinanceTemplateInput
  ): Promise<FinanceTemplate> {
    return this.templates.update(user.userId, workspaceId, templateId, body);
  }

  @Delete(":templateId")
  remove(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("templateId") templateId: string): Promise<void> {
    return this.templates.remove(user.userId, workspaceId, templateId);
  }
}
