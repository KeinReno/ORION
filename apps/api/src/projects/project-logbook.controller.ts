import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import {
  createProjectLogEntryInputSchema, createProjectRelationInputSchema,
  type CreateProjectLogEntryInput, type CreateProjectRelationInput,
  type ProjectLogEntry, type ProjectRelation
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
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("projectId") projectId: string): Promise<ProjectLogEntry[]> {
    return this.logbook.listEntries(user.userId, workspaceId, projectId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(createProjectLogEntryInputSchema)) body: CreateProjectLogEntryInput
  ): Promise<ProjectLogEntry> {
    return this.logbook.createEntry(user.userId, workspaceId, projectId, body);
  }

  @Delete(":entryId")
  @HttpCode(204)
  remove(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("projectId") projectId: string, @Param("entryId") entryId: string): Promise<void> {
    return this.logbook.removeEntry(user.userId, workspaceId, projectId, entryId);
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
