import { Body, Controller, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import {
  restoreInputSchema,
  syncRemoteInputSchema,
  type BackupRef,
  type BackupResult,
  type RestoreInput,
  type RestorePreview,
  type SyncRemote,
  type SyncRemoteInput,
  type SyncRemoteTestResult
} from "@orion/shared-types";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { SyncService } from "./sync.service";

/**
 * ORION — модуль синхронизации/бэкапа, Стадия 1. Маршрут по «модульному
 * контракту»: `workspaces/:workspaceId/sync/...`. Полный контракт (включая
 * Стадии 2–3) — `docs/SYNC.md` §9.
 */
@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/sync")
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get("remote")
  getRemote(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string
  ): Promise<SyncRemote | null> {
    return this.sync.getRemote(user.userId, workspaceId);
  }

  @Put("remote")
  putRemote(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(syncRemoteInputSchema)) body: SyncRemoteInput
  ): Promise<SyncRemote> {
    return this.sync.putRemote(user.userId, workspaceId, body);
  }

  @Post("remote/test")
  testRemote(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string
  ): Promise<SyncRemoteTestResult> {
    return this.sync.testRemote(user.userId, workspaceId);
  }

  @Post("backup")
  backup(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string
  ): Promise<BackupResult> {
    return this.sync.backup(user.userId, workspaceId);
  }

  @Get("backups")
  listBackups(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string
  ): Promise<BackupRef[]> {
    return this.sync.listBackups(user.userId, workspaceId);
  }

  @Post("restore")
  restore(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(restoreInputSchema)) body: RestoreInput
  ): Promise<RestorePreview> {
    return this.sync.restore(user.userId, workspaceId, body);
  }
}
