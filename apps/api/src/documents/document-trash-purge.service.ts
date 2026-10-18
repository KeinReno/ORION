import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { BackgroundJobsService } from "../common/background-jobs.service";
import { PrismaService } from "../common/prisma.service";
import { STORAGE_ADAPTER, storageKey, type StorageAdapter } from "../storage/storage-adapter";

/**
 * Days a document stays in the trash before it's hard-deleted, blob and all.
 * Same window as notes (NoteTrashPurgeService), which this mirrors: a nightly
 * pass across every workspace, so no "current user" → `asSystem`, not
 * `withUser` (see PrismaService / CLAUDE.md "Postgres RLS").
 */
const TRASH_RETENTION_DAYS = 30;
const TRASH_DIR = ".trash";

@Injectable()
export class DocumentTrashPurgeService {
  private readonly logger = new Logger(DocumentTrashPurgeService.name);

  constructor(
    private readonly jobs: BackgroundJobsService,
    private readonly prisma: PrismaService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleCron(): Promise<void> {
    await this.jobs.runJob("documents", "trash-purge", () => this.runPurge());
  }

  async runPurge(): Promise<{ purged: number }> {
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const doomed = await this.prisma.asSystem((tx) =>
      tx.document.findMany({
        where: { deletedAt: { lte: cutoff } },
        select: { id: true, workspaceId: true }
      })
    );

    for (const row of doomed) {
      try {
        // Each trashed node's blob lives at `<ws>/.trash/<id>` (a file, or a
        // whole subtree for a folder). Best-effort: a missing blob is fine.
        await this.storage.remove(storageKey(row.workspaceId, TRASH_DIR, row.id));
      } catch (err) {
        this.logger.warn(`Failed to remove blob for trashed document ${row.id}: ${(err as Error).message}`);
      }
    }

    const { count } = await this.prisma.asSystem((tx) =>
      tx.document.deleteMany({ where: { deletedAt: { lte: cutoff } } })
    );
    if (count > 0) {
      this.logger.log(`Purged ${count} trashed document(s) older than ${TRASH_RETENTION_DAYS} days`);
    }
    return { purged: count };
  }
}
