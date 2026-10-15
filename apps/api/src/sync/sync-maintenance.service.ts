import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { HybridSyncService } from "./hybrid-sync.service";

/** Чистка ленты изменений и журнала операций по сроку хранения (ADR-0016 §2). Обходит RLS через `asSystem`. */
@Injectable()
export class SyncMaintenanceService {
  private readonly logger = new Logger(SyncMaintenanceService.name);

  constructor(private readonly hybrid: HybridSyncService) {}

  @Cron("30 3 * * *")
  async purge(): Promise<void> {
    try {
      const removed = await this.hybrid.purgeExpired();
      if (removed.changes + removed.ops > 0) this.logger.log(`sync: удалено ${removed.changes} записей ленты и ${removed.ops} исходов операций`);
    } catch (error) {
      this.logger.error("Чистка ленты синхронизации не удалась", error instanceof Error ? error.stack : String(error));
    }
  }
}
