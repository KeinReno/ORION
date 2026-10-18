import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { BackgroundJobsService } from "../common/background-jobs.service";
import { HybridSyncService } from "./hybrid-sync.service";

/** Чистка ленты изменений и журнала операций по сроку хранения (ADR-0016 §2). Обходит RLS через `asSystem`. */
@Injectable()
export class SyncMaintenanceService {
  private readonly logger = new Logger(SyncMaintenanceService.name);

  constructor(
    private readonly jobs: BackgroundJobsService,
    private readonly hybrid: HybridSyncService
  ) {}

  @Cron("30 3 * * *")
  async purge(): Promise<void> {
    // Сбой логирует и учитывает обёртка (G9); здесь остаётся только успешный путь.
    await this.jobs.runJob("core", "sync-purge", async () => {
      const removed = await this.hybrid.purgeExpired();
      if (removed.changes + removed.ops > 0) this.logger.log(`sync: удалено ${removed.changes} записей ленты и ${removed.ops} исходов операций`);
    });
  }
}
