import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotesModule } from "../notes/notes.module";
import { TasksModule } from "../tasks/tasks.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { HybridSyncController, SyncDevicesController } from "./hybrid-sync.controller";
import { HybridSyncService } from "./hybrid-sync.service";
import { LinkController } from "./link.controller";
import { LinkIngressService } from "./link-ingress.service";
import { LinkService } from "./link.service";
import { SyncMaintenanceService } from "./sync-maintenance.service";
import { BlobBackupService } from "./blob-backup.service";
import { SnapshotService } from "./snapshot.service";
import { SyncController } from "./sync.controller";
import { SyncService } from "./sync.service";
import { WorkspaceTransferController } from "./workspace-transfer.controller";
import { WorkspaceTransferService } from "./workspace-transfer.service";

/**
 * ORION — синхронизация и бэкап через облако (WebDAV). Разбор Obsidian
 * Remotely Save и архитектура — `docs/SYNC.md`. Здесь только Стадия 1
 * (бэкап/восстановление). Автобэкап-крон и Стадии 2–3 добавятся сюда же.
 * `STORAGE_ADAPTER` не импортируется явно — `StorageModule` `@Global`.
 */
@Module({
  imports: [AuthModule, WorkspacesModule, NotesModule, TasksModule],
  controllers: [SyncController, HybridSyncController, SyncDevicesController, LinkController, WorkspaceTransferController],
  providers: [HybridSyncService, LinkService, LinkIngressService, SyncMaintenanceService, SyncService, SnapshotService, BlobBackupService, WorkspaceTransferService]
})
export class SyncModule {}
