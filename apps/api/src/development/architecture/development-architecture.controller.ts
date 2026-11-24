import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import {
  createArchitectureDiagramInputSchema,
  updateArchitectureDiagramInputSchema,
  type ArchitectureDiagram,
  type ArchitectureDiagramSummary,
  type CreateArchitectureDiagramInput,
  type UpdateArchitectureDiagramInput
} from "@orion/shared-types";
import { CurrentUser } from "../../common/current-user.decorator";
import { RequirePermission } from "../../common/require-permission";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { RequestUser } from "../../auth/jwt.strategy";
import { RequireModule } from "../../modules/require-module";
import { DevelopmentArchitectureService } from "./development-architecture.service";

@RequireModule("orion-dev")
@Controller("workspaces/:workspaceId/development/architect/diagrams")
export class DevelopmentArchitectureController {
  constructor(private readonly architecture: DevelopmentArchitectureService) {}

  @Get()
  @RequirePermission("orion-dev.development_import.read")
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<ArchitectureDiagramSummary[]> {
    return this.architecture.list(user.userId, workspaceId);
  }

  @Post()
  @RequirePermission("orion-dev.development_import.create")
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createArchitectureDiagramInputSchema)) body: CreateArchitectureDiagramInput
  ): Promise<{ id: string }> {
    return this.architecture.create(user.userId, workspaceId, body);
  }

  @Get(":diagramId")
  @RequirePermission("orion-dev.development_import.read")
  get(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("diagramId") diagramId: string): Promise<ArchitectureDiagram> {
    return this.architecture.get(user.userId, workspaceId, diagramId);
  }

  @Put(":diagramId")
  @RequirePermission("orion-dev.development_import.update")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("diagramId") diagramId: string,
    @Body(new ZodValidationPipe(updateArchitectureDiagramInputSchema)) body: UpdateArchitectureDiagramInput
  ): Promise<ArchitectureDiagram> {
    return this.architecture.update(user.userId, workspaceId, diagramId, body);
  }

  @Delete(":diagramId")
  @HttpCode(204)
  @RequirePermission("orion-dev.development_import.delete")
  remove(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("diagramId") diagramId: string): Promise<void> {
    return this.architecture.remove(user.userId, workspaceId, diagramId);
  }
}
