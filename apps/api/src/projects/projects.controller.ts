import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import {
  createProjectFromTemplateInputSchema,
  createProjectInputSchema,
  duplicateProjectInputSchema,
  linkProjectHistoryDecisionInputSchema,
  projectHistoryQuerySchema,
  projectPortfolioQuerySchema,
  reorderProjectsInputSchema,
  updateProjectInputSchema,
  type CreateProjectFromTemplateInput,
  type CreateProjectInput,
  type DuplicateProjectInput,
  type LinkProjectHistoryDecisionInput,
  type Project,
  type ProjectDetail,
  type ProjectFromTemplateResult,
  type ProjectHistoryEntry,
  type ProjectHistoryPage,
  type ProjectPortfolio,
  type ReorderProjectsInput,
  type UpdateProjectInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { RequirePermission } from "../common/require-permission";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequireModule } from "../modules/require-module";
import { ProjectHistoryService } from "./project-history.service";
import { ProjectPortfolioService } from "./project-portfolio.service";
import { ProjectTemplatesService } from "./project-templates.service";
import { ProjectsService } from "./projects.service";

/**
 * Порядок методов важен: статические пути (`portfolio`, `from-template`) объявлены ДО
 * `:projectId`, иначе Express принял бы их за id проекта.
 */
@RequireModule("projects")
@Controller("workspaces/:workspaceId/projects")
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly portfolio: ProjectPortfolioService,
    private readonly templates: ProjectTemplatesService,
    private readonly history: ProjectHistoryService
  ) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Query("archived") archived?: string): Promise<Project[]> {
    return this.projects.list(user.userId, workspaceId, archived === "true");
  }

  @Put("order")
  reorder(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Body(new ZodValidationPipe(reorderProjectsInputSchema)) body: ReorderProjectsInput): Promise<{ updated: number }> {
    return this.projects.reorder(user.userId, workspaceId, body);
  }

  /** Портфель проектов (3.3): агрегаты по пространству с фильтрами и явными лимитами. */
  @Get("portfolio")
  @RequirePermission("projects.portfolio.read")
  getPortfolio(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Query() query: unknown): Promise<ProjectPortfolio> {
    return this.portfolio.get(user.userId, workspaceId, parseQuery(projectPortfolioQuerySchema, query));
  }

  /** Создание проекта из шаблона (3.2): проект и вся структура — одной транзакцией. */
  @Post("from-template")
  @RequirePermission("projects.project.create")
  createFromTemplate(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createProjectFromTemplateInputSchema)) body: CreateProjectFromTemplateInput
  ): Promise<ProjectFromTemplateResult> {
    return this.templates.createFromTemplate(user.userId, workspaceId, body);
  }

  @Get(":projectId")
  get(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("projectId") projectId: string): Promise<ProjectDetail> {
    return this.projects.get(user.userId, workspaceId, projectId);
  }

  @Post()
  @RequirePermission("projects.project.create")
  create(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Body(new ZodValidationPipe(createProjectInputSchema)) body: CreateProjectInput): Promise<Project> {
    return this.projects.create(user.userId, workspaceId, body);
  }

  /** Дублирование структуры проекта (3.2). */
  @Post(":projectId/duplicate")
  @RequirePermission("projects.project.create")
  duplicate(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(duplicateProjectInputSchema)) body: DuplicateProjectInput
  ): Promise<ProjectFromTemplateResult> {
    return this.templates.duplicate(user.userId, workspaceId, projectId, body);
  }

  @Patch(":projectId")
  @RequirePermission("projects.project.update")
  update(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("projectId") projectId: string, @Body(new ZodValidationPipe(updateProjectInputSchema)) body: UpdateProjectInput): Promise<Project> {
    return this.projects.update(user.userId, workspaceId, projectId, body);
  }

  @Delete(":projectId")
  @RequirePermission("projects.project.delete")
  archive(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("projectId") projectId: string): Promise<Project> {
    return this.projects.archive(user.userId, workspaceId, projectId);
  }

  // --- История изменений (3.4) -------------------------------------------------------------------

  @Get(":projectId/history")
  @RequirePermission("projects.history.read")
  listHistory(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Query() query: unknown
  ): Promise<ProjectHistoryPage> {
    return this.history.list(user.userId, workspaceId, projectId, parseQuery(projectHistoryQuerySchema, query));
  }

  /** Связать изменение с записью журнала («решением»). */
  @Post(":projectId/history/:historyId/decision")
  @RequirePermission("projects.project.update")
  linkHistoryDecision(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("historyId") historyId: string,
    @Body(new ZodValidationPipe(linkProjectHistoryDecisionInputSchema)) body: LinkProjectHistoryDecisionInput
  ): Promise<ProjectHistoryEntry> {
    return this.history.linkDecision(user.userId, workspaceId, projectId, historyId, body);
  }

  @Delete(":projectId/history/:historyId/decision")
  @RequirePermission("projects.project.update")
  unlinkHistoryDecision(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("historyId") historyId: string
  ): Promise<ProjectHistoryEntry> {
    return this.history.unlinkDecision(user.userId, workspaceId, projectId, historyId);
  }
}

/** Query-строки приходят строками; схема приводит числа и отбрасывает лишние ключи. */
function parseQuery<T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { flatten: () => unknown } } }, query: unknown): T {
  const parsed = schema.safeParse(query ?? {});
  if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
  return parsed.data;
}
