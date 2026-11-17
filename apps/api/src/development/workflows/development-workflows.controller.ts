import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import {
  createWorkflowInputSchema,
  updateWorkflowInputSchema,
  type CreateWorkflowInput,
  type UpdateWorkflowInput,
  type Workflow,
  type WorkflowSummary
} from "@orion/shared-types";
import { CurrentUser } from "../../common/current-user.decorator";
import { RequirePermission } from "../../common/require-permission";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { RequestUser } from "../../auth/jwt.strategy";
import { RequireModule } from "../../modules/require-module";
import { DevelopmentWorkflowsService } from "./development-workflows.service";

/**
 * Workbench (11.4): пользовательские процессы — схемы из узлов и связей.
 * Граф хранится целиком в jsonb; `PUT` заменяет его транзакционно.
 */
@RequireModule("orion-dev")
@Controller("workspaces/:workspaceId/development/workflows")
export class DevelopmentWorkflowsController {
  constructor(private readonly workflows: DevelopmentWorkflowsService) {}

  @Get()
  @RequirePermission("orion-dev.development_import.read")
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string
  ): Promise<WorkflowSummary[]> {
    return this.workflows.list(user.userId, workspaceId);
  }

  @Post()
  @RequirePermission("orion-dev.development_import.create")
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createWorkflowInputSchema)) body: CreateWorkflowInput
  ): Promise<{ id: string }> {
    return this.workflows.create(user.userId, workspaceId, body);
  }

  @Get(":workflowId")
  @RequirePermission("orion-dev.development_import.read")
  get(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("workflowId") workflowId: string
  ): Promise<Workflow> {
    return this.workflows.get(user.userId, workspaceId, workflowId);
  }

  @Put(":workflowId")
  @RequirePermission("orion-dev.development_import.update")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("workflowId") workflowId: string,
    @Body(new ZodValidationPipe(updateWorkflowInputSchema)) body: UpdateWorkflowInput
  ): Promise<Workflow> {
    return this.workflows.update(user.userId, workspaceId, workflowId, body);
  }

  @Delete(":workflowId")
  @HttpCode(204)
  @RequirePermission("orion-dev.development_import.delete")
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("workflowId") workflowId: string
  ): Promise<void> {
    await this.workflows.remove(user.userId, workspaceId, workflowId);
  }
}
