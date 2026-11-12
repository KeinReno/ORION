import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createProjectTemplateInputSchema,
  updateProjectTemplateInputSchema,
  type CreateProjectTemplateInput,
  type ProjectTemplate,
  type UpdateProjectTemplateInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { RequirePermission } from "../common/require-permission";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequireModule } from "../modules/require-module";
import { ProjectTemplatesService } from "./project-templates.service";

/**
 * Шаблоны проектов (задание 03, 3.2). Шаблон — не проект: живёт в отдельной таблице,
 * поэтому у него свои права `projects.template.*`. Путь `projects/templates` не
 * конфликтует с `projects/:projectId`: контроллер зарегистрирован ДО `ProjectsController`.
 */
@RequireModule("projects")
@Controller("workspaces/:workspaceId/projects/templates")
export class ProjectTemplatesController {
  constructor(private readonly templates: ProjectTemplatesService) {}

  @Get()
  @RequirePermission("projects.template.read")
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Query("archived") archived?: string): Promise<ProjectTemplate[]> {
    return this.templates.list(user.userId, workspaceId, archived === "true");
  }

  @Get(":templateId")
  @RequirePermission("projects.template.read")
  get(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("templateId") templateId: string): Promise<ProjectTemplate> {
    return this.templates.get(user.userId, workspaceId, templateId);
  }

  @Post()
  @RequirePermission("projects.template.create")
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createProjectTemplateInputSchema)) body: CreateProjectTemplateInput
  ): Promise<ProjectTemplate> {
    return this.templates.create(user.userId, workspaceId, body);
  }

  @Patch(":templateId")
  @RequirePermission("projects.template.update")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("templateId") templateId: string,
    @Body(new ZodValidationPipe(updateProjectTemplateInputSchema)) body: UpdateProjectTemplateInput
  ): Promise<ProjectTemplate> {
    return this.templates.update(user.userId, workspaceId, templateId, body);
  }

  /** Удаление = архивация: шаблон можно вернуть (`PATCH archivedAt: null`), данные не теряются. */
  @Delete(":templateId")
  @RequirePermission("projects.template.delete")
  archive(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("templateId") templateId: string): Promise<ProjectTemplate> {
    return this.templates.archive(user.userId, workspaceId, templateId);
  }
}
