import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createProjectLogEntryInputSchema, createProjectRelationInputSchema,
  projectLogFiltersSchema, updateProjectLogEntryInputSchema,
  type CreateProjectLogEntryInput, type CreateProjectRelationInput,
  type ProjectLogEntry, type ProjectLogFilters, type ProjectLogRelated, type ProjectLogSummary,
  type ProjectRelation, type UpdateProjectLogEntryInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequireModule } from "../modules/require-module";
import { RequirePlugin } from "../plugins/require-plugin";
import { ProjectLogbookService } from "./project-logbook.service";

@RequireModule("projects")
@RequirePlugin("projects-logbook")
@Controller("workspaces/:workspaceId/projects/:projectId/logbook")
export class ProjectLogbookController {
  constructor(private readonly logbook: ProjectLogbookService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Query(new ZodValidationPipe(projectLogFiltersSchema)) filters: ProjectLogFilters
  ): Promise<ProjectLogEntry[]> {
    return this.logbook.listEntries(user.userId, workspaceId, projectId, filters);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(createProjectLogEntryInputSchema)) body: CreateProjectLogEntryInput
  ): Promise<ProjectLogEntry> {
    return this.logbook.createEntry(user.userId, workspaceId, projectId, body);
  }

  /** Сводка по журналу: количества по типам, просроченные гипотезы, открытые инциденты, решения без результатов. */
  @Get("summary")
  summary(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Query(new ZodValidationPipe(projectLogFiltersSchema)) filters: ProjectLogFilters
  ): Promise<ProjectLogSummary> {
    return this.logbook.summary(user.userId, workspaceId, projectId, filters);
  }

  @Patch(":entryId")
  update(
    @CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("projectId") projectId: string,
    @Param("entryId") entryId: string,
    @Body(new ZodValidationPipe(updateProjectLogEntryInputSchema)) body: UpdateProjectLogEntryInput
  ): Promise<ProjectLogEntry> {
    return this.logbook.updateEntry(user.userId, workspaceId, projectId, entryId, body);
  }

  @Delete(":entryId")
  @HttpCode(204)
  remove(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("projectId") projectId: string, @Param("entryId") entryId: string): Promise<void> {
    return this.logbook.removeEntry(user.userId, workspaceId, projectId, entryId);
  }
}

/** Список журнала по всему пространству + универсальные связи записи с материалами. */
@RequireModule("projects")
@RequirePlugin("projects-logbook")
@Controller("workspaces/:workspaceId/project-log")
export class ProjectLogbookWorkspaceController {
  constructor(private readonly logbook: ProjectLogbookService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query(new ZodValidationPipe(projectLogFiltersSchema)) filters: ProjectLogFilters
  ): Promise<ProjectLogEntry[]> {
    return this.logbook.listWorkspaceEntries(user.userId, workspaceId, filters);
  }

  /** Агрегирует прикреплённые материалы всех типов через EntityLink (Knowledge, Documents, Notes, …). */
  @Get(":entryId/related")
  related(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("entryId") entryId: string): Promise<ProjectLogRelated> {
    return this.logbook.related(user.userId, workspaceId, entryId);
  }
}

@RequireModule("projects")
@RequirePlugin("projects-logbook")
@Controller("workspaces/:workspaceId/projects/:projectId/relations")
export class ProjectRelationsController {
  constructor(private readonly logbook: ProjectLogbookService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("projectId") projectId: string): Promise<ProjectRelation[]> {
    return this.logbook.listRelations(user.userId, workspaceId, projectId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(createProjectRelationInputSchema)) body: CreateProjectRelationInput
  ): Promise<ProjectRelation> {
    return this.logbook.createRelation(user.userId, workspaceId, projectId, body);
  }

  @Delete(":relationId")
  @HttpCode(204)
  remove(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("projectId") projectId: string, @Param("relationId") relationId: string): Promise<void> {
    return this.logbook.removeRelation(user.userId, workspaceId, projectId, relationId);
  }
}
