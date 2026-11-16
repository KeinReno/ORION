import { BadRequestException, Body, Controller, Get, Param, Post, Put, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
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
import { fixMultipartFilename, MAX_BACKUP_UPLOAD_BYTES } from "../common/multipart";
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

  /** Локальный экспорт: тот же зашифрованный `.orion`, что уходит в облако, — файлом на скачивание. */
  @Get("local-export")
  async exportLocal(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string
  ): Promise<StreamableFile> {
    const { name, sealed } = await this.sync.exportLocal(user.userId, workspaceId);
    return new StreamableFile(sealed, {
      disposition: `attachment; filename="${name}"`,
      type: "application/octet-stream"
    });
  }

  /** Превью локального восстановления: multipart с файлом `.orion`, ничего не пишет в БД. */
  @Post("local-restore/preview")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_BACKUP_UPLOAD_BYTES } }))
  previewLocalRestore(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined
  ): Promise<RestorePreview> {
    return this.sync.localRestore(
      user.userId,
      workspaceId,
      requireBackupFile(file),
      fixMultipartFilename(file!.originalname),
      { snapshot: fixMultipartFilename(file!.originalname), dryRun: true }
    );
  }

  /** Применение локального восстановления: тот же файл + `confirmWorkspaceId` и `expectedManifestHash` из превью. */
  @Post("local-restore/apply")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_BACKUP_UPLOAD_BYTES } }))
  applyLocalRestore(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
    @Body() body: unknown
  ): Promise<RestorePreview> {
    const fields = (body ?? {}) as Record<string, unknown>;
    const parsed = restoreInputSchema.safeParse({
      snapshot: fixMultipartFilename(file?.originalname ?? "backup.orion"),
      dryRun: false,
      confirmWorkspaceId: typeof fields.confirmWorkspaceId === "string" ? fields.confirmWorkspaceId : undefined,
      expectedManifestHash: typeof fields.expectedManifestHash === "string" ? fields.expectedManifestHash : undefined
    });
    if (!parsed.success) {
      throw new BadRequestException("Нужны поля confirmWorkspaceId и expectedManifestHash из предпросмотра");
    }
    return this.sync.localRestore(
      user.userId,
      workspaceId,
      requireBackupFile(file),
      parsed.data.snapshot!,
      parsed.data
    );
  }
}

/** Multipart без файла — сразу 400, а не падение на пустом буфере внутри конвейера восстановления. */
function requireBackupFile(file: { buffer: Buffer; originalname: string } | undefined): Buffer {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new BadRequestException("Файл бэкапа не прикреплён");
  }
  return file.buffer;
}
