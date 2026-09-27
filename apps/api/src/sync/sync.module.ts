import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { BlobBackupService } from "./blob-backup.service";
import { SnapshotService } from "./snapshot.service";
import { SyncController } from "./sync.controller";
import { SyncService } from "./sync.service";

/**
 * ORION — синхронизация и бэкап через облако (WebDAV). Разбор Obsidian
 * Remotely Save и архитектура — `docs/SYNC.md`. Здесь только Стадия 1
 * (бэкап/восстановление). Автобэкап-крон и Стадии 2–3 добавятся сюда же.
 * `STORAGE_ADAPTER` не импортируется явно — `StorageModule` `@Global`.
 */
@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [SyncController],
  providers: [SyncService, SnapshotService, BlobBackupService]
})
export class SyncModule {}
