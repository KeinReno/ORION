import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createDevelopmentRepositoryInputSchema,
  developmentGitCompareQuerySchema,
  developmentGitGraphQuerySchema,
  updateDevelopmentRepositoryInputSchema,
  type CreateDevelopmentRepositoryInput,
  type DevelopmentGitCompare,
  type DevelopmentGitCompareQuery,
  type DevelopmentGitGraph,
  type DevelopmentGitGraphQuery,
  type DevelopmentRepository,
  type DevelopmentRepositoryRoots,
  type UpdateDevelopmentRepositoryInput
} from "@orion/shared-types";
import { CurrentUser } from "../../common/current-user.decorator";
import { RequirePermission } from "../../common/require-permission";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { RequestUser } from "../../auth/jwt.strategy";
import { RequireModule } from "../../modules/require-module";
import { DevelopmentGitService } from "./development-git.service";
import { DevelopmentTaskLinksService, type SyncLinksResult } from "./development-task-links.service";

/**
 * Git Workspace (11.1) под путём задания: `development/git/:repoId/...`.
 *
 * Репозиторий выбирается по id из списка, зарегистрированного владельцем; произвольный путь с
 * клиента не принимается. Всё чтение — только `git log`/`for-each-ref`/`rev-parse`/`diff`; push,
 * fetch и другие изменяющие операции отсутствуют (вне объёма задания).
 */
@RequireModule("orion-dev")
@Controller("workspaces/:workspaceId/development/git")
export class DevelopmentGitController {
  constructor(
    private readonly git: DevelopmentGitService,
    private readonly links: DevelopmentTaskLinksService
  ) {}

  @Get("repositories")
  @RequirePermission("orion-dev.development_import.read")
  repositories(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<DevelopmentRepository[]> {
    return this.git.listRepositories(user.userId, workspaceId);
  }

  @Post("repositories")
  @RequirePermission("orion-dev.development_import.create")
  addRepository(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createDevelopmentRepositoryInputSchema)) body: CreateDevelopmentRepositoryInput
  ): Promise<DevelopmentRepository> {
    return this.git.registerRepository(user.userId, workspaceId, body);
  }

  @Patch("repositories/:repositoryId")
  @RequirePermission("orion-dev.development_import.update")
  updateRepository(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("repositoryId") repositoryId: string,
    @Body(new ZodValidationPipe(updateDevelopmentRepositoryInputSchema)) body: UpdateDevelopmentRepositoryInput
  ): Promise<DevelopmentRepository> {
    return this.git.updateRepository(user.userId, workspaceId, repositoryId, body);
  }

  /** Разрешённые для регистрации корни (env `ORION_DEV_REPOSITORY_ROOTS`) — подсказка для формы. */
  @Get("repositories/allowed-roots")
  @RequirePermission("orion-dev.development_import.read")
  allowedRoots(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<DevelopmentRepositoryRoots> {
    return this.git.allowedRoots(user.userId, workspaceId);
  }

  @Delete("repositories/:repositoryId")
  @HttpCode(204)
  @RequirePermission("orion-dev.development_import.delete")
  async removeRepository(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("repositoryId") repositoryId: string
  ): Promise<void> {
    await this.git.removeRepository(user.userId, workspaceId, repositoryId);
  }

  @Get(":repositoryId/graph")
  @RequirePermission("orion-dev.development_import.read")
  graph(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("repositoryId") repositoryId: string,
    @Query(new ZodValidationPipe(developmentGitGraphQuerySchema)) query: DevelopmentGitGraphQuery
  ): Promise<DevelopmentGitGraph> {
    return this.git.graph(user.userId, workspaceId, repositoryId, query);
  }

  @Get(":repositoryId/compare")
  @RequirePermission("orion-dev.development_import.read")
  compare(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("repositoryId") repositoryId: string,
    @Query(new ZodValidationPipe(developmentGitCompareQuerySchema)) query: DevelopmentGitCompareQuery
  ): Promise<DevelopmentGitCompare> {
    return this.git.compare(user.userId, workspaceId, repositoryId, query);
  }

  /** Разовое чтение истории для конвенции `#<задача>`; повтор безопасен (уникальный ключ). */
  @Post(":repositoryId/sync-links")
  @HttpCode(200)
  @RequirePermission("tasks.task.update")
  async syncLinks(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("repositoryId") repositoryId: string
  ): Promise<SyncLinksResult> {
    if (!repositoryId) throw new BadRequestException("Не указан репозиторий");
    return this.links.syncLinks(user.userId, workspaceId, repositoryId);
  }
}
