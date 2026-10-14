import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import {
  createProjectInputSchema,
  reorderProjectsInputSchema,
  type ReorderProjectsInput,
  updateProjectInputSchema,
  type CreateProjectInput,
  type Project,
  type ProjectDetail,
  type UpdateProjectInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequireModule } from "../modules/require-module";
import { ProjectsService } from "./projects.service";

@RequireModule("projects")
@Controller("workspaces/:workspaceId/projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Query("archived") archived?: string): Promise<Project[]> {
    return this.projects.list(user.userId, workspaceId, archived === "true");
  }

  @Put("order")
  reorder(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Body(new ZodValidationPipe(reorderProjectsInputSchema)) body: ReorderProjectsInput): Promise<{ updated: number }> {
    return this.projects.reorder(user.userId, workspaceId, body);
  }

  @Get(":projectId")
  get(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("projectId") projectId: string): Promise<ProjectDetail> {
    return this.projects.get(user.userId, workspaceId, projectId);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Body(new ZodValidationPipe(createProjectInputSchema)) body: CreateProjectInput): Promise<Project> {
    return this.projects.create(user.userId, workspaceId, body);
  }

  @Patch(":projectId")
  update(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("projectId") projectId: string, @Body(new ZodValidationPipe(updateProjectInputSchema)) body: UpdateProjectInput): Promise<Project> {
    return this.projects.update(user.userId, workspaceId, projectId, body);
  }

  @Delete(":projectId")
  archive(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("projectId") projectId: string): Promise<Project> {
    return this.projects.archive(user.userId, workspaceId, projectId);
  }
}
