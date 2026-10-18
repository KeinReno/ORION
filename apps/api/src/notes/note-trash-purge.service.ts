import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { BackgroundJobsService } from "../common/background-jobs.service";
import { PrismaService } from "../common/prisma.service";

/**
 * Days a note stays in the trash before it's hard-deleted for good. Long
 * enough to notice an accidental delete, short enough that the trash doesn't
 * quietly become permanent storage.
 */
const TRASH_RETENTION_DAYS = 30;

/** Version-history snapshots kept per note; older ones are pruned. */
const REVISIONS_KEPT_PER_NOTE = 50;

/**
 * Nightly notes housekeeping across every workspace: empty the trash past
 * its retention window, and cap each note's version history. Like
 * DueTaskCheckerService this has no "current user", so it goes through
 * `asSystem` (an audited RLS bypass) rather than `withUser` — see
 * PrismaService and CLAUDE.md "Postgres RLS".
 */
@Injectable()
export class NoteTrashPurgeService {
  private readonly logger = new Logger(NoteTrashPurgeService.name);

  constructor(
    private readonly jobs: BackgroundJobsService,
    private readonly prisma: PrismaService
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleCron(): Promise<void> {
    // Две независимые задачи: сбой чистки корзины не должен отменять прореживание ревизий.
    await this.jobs.runJob("notes", "trash-purge", () => this.runPurge());
    await this.jobs.runJob("notes", "revision-prune", () => this.pruneRevisions());
  }

  async runPurge(): Promise<{ purged: number }> {
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.asSystem((tx) =>
      tx.note.deleteMany({ where: { deletedAt: { lte: cutoff } } })
    );
    if (count > 0) {
      this.logger.log(`Purged ${count} trashed note(s) older than ${TRASH_RETENTION_DAYS} days`);
    }
    return { purged: count };
  }

  /** Keep only the newest `REVISIONS_KEPT_PER_NOTE` snapshots per note. */
  async pruneRevisions(): Promise<{ pruned: number }> {
    const pruned = await this.prisma.asSystem((tx) =>
      tx.$executeRaw`
        DELETE FROM "note_revisions" nr
        USING (
          SELECT id, row_number() OVER (PARTITION BY "noteId" ORDER BY "createdAt" DESC) AS rn
          FROM "note_revisions"
        ) ranked
        WHERE ranked.id = nr.id AND ranked.rn > ${REVISIONS_KEPT_PER_NOTE}
      `
    );
    if (pruned > 0) {
      this.logger.log(`Pruned ${pruned} old note revision(s)`);
    }
    return { pruned };
  }
}
