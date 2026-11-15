import { Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import {
  architectLayoutInputSchema,
  architectMapQuerySchema,
  architectProjectSchemaSchema,
  createArchitectSnapshotInputSchema,
  type ArchitectComparison,
  type ArchitectLayout,
  type ArchitectLayoutInput,
  type ArchitectMap,
  type ArchitectMapQuery,
  type ArchitectProjectSchema,
  type ArchitectSnapshot,
  type ArchitectSnapshotSummary,
  type CreateArchitectSnapshotInput
} from "@orion/shared-types";
import { CurrentUser } from "../../common/current-user.decorator";
import { RequirePermission } from "../../common/require-permission";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { RequestUser } from "../../auth/jwt.strategy";
import { RequireModule } from "../../modules/require-module";
import { DevelopmentArchitectService } from "./development-architect.service";

/**
 * Architect (11.3): карта для 2D-редактора, пользовательская раскладка и сравнение с проектной
 * схемой. Карта каждый раз строится анализатором; здесь сохраняются только позиции узлов и
 * загруженная схема.
 */
@RequireModule("orion-dev")
@Controller("workspaces/:workspaceId/development/architect")
export class DevelopmentArchitectController {
  constructor(private readonly architect: DevelopmentArchitectService) {}

  @Get(":repositoryId/map")
  @RequirePermission("orion-dev.development_import.read")
  map(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("repositoryId") repositoryId: string,
    @Query(new ZodValidationPipe(architectMapQuerySchema)) query: ArchitectMapQuery
  ): Promise<ArchitectMap> {
    return this.architect.map(user.userId, workspaceId, repositoryId, query.path, query.ref);
  }

  @Get(":repositoryId/layout")
  @RequirePermission("orion-dev.development_import.read")
  layout(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("repositoryId") repositoryId: string
  ): Promise<ArchitectLayout> {
    return this.architect.layout(user.userId, workspaceId, repositoryId);
  }

  @Put(":repositoryId/layout")
  @RequirePermission("orion-dev.development_import.update")
  saveLayout(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("repositoryId") repositoryId: string,
    @Body(new ZodValidationPipe(architectLayoutInputSchema)) body: ArchitectLayoutInput
  ): Promise<ArchitectLayout> {
    return this.architect.saveLayout(user.userId, workspaceId, repositoryId, body);
  }

  @Get(":repositoryId/project-schema")
  @RequirePermission("orion-dev.development_import.read")
  projectSchema(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("repositoryId") repositoryId: string
  ): Promise<ArchitectProjectSchema | null> {
    return this.architect.projectSchema(user.userId, workspaceId, repositoryId);
  }

  @Put(":repositoryId/project-schema")
  @RequirePermission("orion-dev.development_import.update")
  saveProjectSchema(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("repositoryId") repositoryId: string,
    @Body(new ZodValidationPipe(architectProjectSchemaSchema)) body: ArchitectProjectSchema
  ): Promise<ArchitectProjectSchema> {
    return this.architect.saveProjectSchema(user.userId, workspaceId, repositoryId, body);
  }

  @Get(":repositoryId/compare")
  @RequirePermission("orion-dev.development_import.read")
  compare(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("repositoryId") repositoryId: string
  ): Promise<ArchitectComparison> {
    return this.architect.compare(user.userId, workspaceId, repositoryId);
  }

  @Post(":repositoryId/snapshots")
  @RequirePermission("orion-dev.development_import.update")
  createSnapshot(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("repositoryId") repositoryId: string,
    @Body(new ZodValidationPipe(createArchitectSnapshotInputSchema)) body: CreateArchitectSnapshotInput
  ): Promise<ArchitectSnapshotSummary> {
    return this.architect.createSnapshot(user.userId, workspaceId, repositoryId, body.ref);
  }

  @Get(":repositoryId/snapshots")
  @RequirePermission("orion-dev.development_import.read")
  listSnapshots(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("repositoryId") repositoryId: string
  ): Promise<ArchitectSnapshotSummary[]> {
    return this.architect.listSnapshots(user.userId, workspaceId, repositoryId);
  }

  @Get(":repositoryId/snapshots/:sha")
  @RequirePermission("orion-dev.development_import.read")
  snapshot(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("repositoryId") repositoryId: string,
    @Param("sha") sha: string
  ): Promise<ArchitectSnapshot> {
    return this.architect.snapshot(user.userId, workspaceId, repositoryId, sha);
  }
}
