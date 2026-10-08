import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { createProjectUpdateInputSchema, type CreateProjectUpdateInput, type ProjectUpdate } from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequireModule } from "../modules/require-module";
import { ProjectUpdatesService } from "./project-updates.service";

@RequireModule("projects")
@Controller("workspaces/:workspaceId/projects/:projectId/updates")
export class ProjectUpdatesController {
  constructor(private readonly updates: ProjectUpdatesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("projectId") projectId: string): Promise<ProjectUpdate[]> {
    return this.updates.list(user.userId, workspaceId, projectId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(createProjectUpdateInputSchema)) body: CreateProjectUpdateInput
  ): Promise<ProjectUpdate> {
    return this.updates.create(user.userId, workspaceId, projectId, body);
  }

  @Delete(":updateId")
  @HttpCode(204)
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("updateId") updateId: string
  ): Promise<void> {
    return this.updates.remove(user.userId, workspaceId, projectId, updateId);
  }
}
