import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma, type RecurrenceInterval, type TransactionType } from "@prisma/client";
import { pluginOffWhere } from "../../plugins/require-plugin";
import { PrismaService } from "../../common/prisma.service";

/**
 * Mirrors DueTaskCheckerService (apps/api/src/notifications/) — a
 * system-wide cron, only ever reachable this way (no per-user manual
 * trigger in v1, see docs/HISTORY.md v0.8), that materialises due recurring
 * rules into real Transaction rows and advances nextRunAt. Hourly is
 * plenty for day/week-granularity schedules — no need for the task
 * checker's per-minute cadence.
 *
 * S21 idempotency: two workers (or a retried tick after a crash) racing on
 * the same rule must produce exactly one Transaction, and rollback must
 * never advance the schedule for an occurrence that wasn't actually
 * created. Two independent DB-level barriers, not an in-process flag
 * (that doesn't survive a restart or a second instance):
 *
 * 1. Row lock — `SELECT ... FOR UPDATE` on the specific
 *    `finance_recurring_transactions` row inside the same `asSystem`
 *    transaction that creates the Transaction and advances `nextRunAt`.
 *    A second worker touching the same rule blocks on the lock, then — once
 *    the first commits — re-reads `nextRunAt`/`pausedAt` and sees the
 *    occurrence already advanced/paused, so it skips instead of duplicating.
 * 2. `Transaction.(recurringRuleId, scheduledFor)` UNIQUE constraint — the
 *    durable barrier of last resort if two rows somehow reach the insert
 *    for the same occurrence outside a shared lock (e.g. a stale in-memory
 *    candidate list from before this worker's process restarted). The
 *    loser gets Postgres error P2002 and is treated as "already
 *    materialised", not a crash and not a duplicate.
 *
 * `scheduledFor` is always the rule's `nextRunAt` read *inside the locked
 * transaction*, never `new Date()` — the occurrence a row represents is a
 * schedule slot, not "whenever the cron happened to run" (matters for
 * downtime catch-up: a rule that missed three days should get three rows
 * dated for their actual scheduled days, one per hourly tick).
 */
/**
 * Downtime catch-up bound: a rule only ever materialises one occurrence
 * per `runCheck()` pass (it re-queues itself for the next tick via its
 * still-due `nextRunAt`), so this caps how many *distinct rules* one pass
 * touches — not how many occurrences. Without it, a server that was down
 * for months with hundreds of due rules across workspaces would try to
 * process all of them synchronously in one cron tick. Exported (not a
 * private static) so tests can assert on the real value, not a duplicate.
 */
export const RECURRING_CHECK_BATCH_LIMIT = 200;

@Injectable()
export class RecurringCheckerService {
  private readonly logger = new Logger(RecurringCheckerService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    await this.runCheck();
  }

  async runCheck(): Promise<{ created: number; skipped: number }> {
    const due = await this.prisma.asSystem((tx) =>
      tx.recurringTransaction.findMany({
        where: {
          nextRunAt: { lte: new Date() },
          pausedAt: null,
          workspace: { NOT: [{ disabledModules: { has: "finance" } }, pluginOffWhere("finance-recurring")] }
        },
        // Oldest-due-first, so a starved rule under a long backlog isn't
        // perpetually pushed behind rules with a more recent nextRunAt.
        orderBy: { nextRunAt: "asc" },
        take: RECURRING_CHECK_BATCH_LIMIT
      })
    );
    let created = 0;
    let skipped = 0;
    for (const candidate of due) {
      const result = await this.materializeOne(candidate.id);
      if (result === "created") created++;
      else skipped++;
    }
    if (created > 0 || skipped > 0) {
      this.logger.log(
        `Recurring finance check: materialised ${created}, skipped ${skipped} (already advanced/paused/deleted since candidate read)` +
          (due.length === RECURRING_CHECK_BATCH_LIMIT
            ? ` — hit batch limit ${RECURRING_CHECK_BATCH_LIMIT}, remainder deferred to next tick`
            : "")
      );
    }
    return { created, skipped };
  }

  /**
   * One rule, one transaction, one locked row. Returns "created" only if
   * this call is the one that inserted the Transaction; every other outcome
   * (paused since the candidate scan, already advanced by a racing worker,
   * deleted concurrently, or a unique-constraint loss) is "skipped" — never
   * throws for those expected races, so one bad rule can't take down the
   * whole batch.
   */
  private async materializeOne(ruleId: string): Promise<"created" | "skipped"> {
    try {
      return await this.prisma.asSystem(async (tx) => {
        // Row lock — serializes concurrent workers/ticks on this exact rule.
        const locked = await tx.$queryRaw<
          {
            id: string;
            workspaceId: string;
            accountId: string;
            categoryId: string | null;
            type: TransactionType;
            amount: number;
            note: string;
            interval: RecurrenceInterval;
            anchorDay: number;
            nextRunAt: Date;
            pausedAt: Date | null;
          }[]
        >(Prisma.sql`SELECT * FROM "finance_recurring_transactions" WHERE "id" = ${ruleId} FOR UPDATE`);
        const rule = locked[0];
        if (!rule) return "skipped"; // deleted concurrently
        if (rule.pausedAt) return "skipped"; // paused since the candidate scan
        if (rule.nextRunAt > new Date()) return "skipped"; // a racing worker already advanced it

        const scheduledFor = rule.nextRunAt;
        try {
          // v0.9: Transaction's amount/category moved into a child `lines`
          // table (see docs/HISTORY.md) — recurring rules themselves stay
          // single-category/non-transfer, so this is just one nested line.
          await tx.transaction.create({
            data: {
              workspaceId: rule.workspaceId,
              accountId: rule.accountId,
              type: rule.type,
              note: rule.note,
              occurredAt: scheduledFor,
              recurringRuleId: rule.id,
              scheduledFor,
              lines: { create: [{ workspaceId: rule.workspaceId, categoryId: rule.categoryId, amount: rule.amount }] }
            }
          });
        } catch (err) {
          // Belt-and-suspenders: the row lock above should make this
          // unreachable in practice, but the UNIQUE constraint is the
          // actual durable barrier — treat a collision as "already done",
          // not a failure, and do NOT advance nextRunAt again below (that
          // already happened on whichever attempt won the insert).
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
            return "skipped";
          }
          throw err;
        }

        // Advancement is tied to the occurrence that was actually created —
        // it happens only after the insert succeeds, inside the same
        // transaction, so a rollback (this insert failing for any other
        // reason) never leaves nextRunAt pointing past a materialisation
        // that didn't happen.
        await tx.recurringTransaction.update({
          where: { id: rule.id },
          data: { nextRunAt: advance(scheduledFor, rule.interval, rule.anchorDay) }
        });
        return "created";
      });
    } catch (err) {
      this.logger.error(`Failed to materialise recurring transaction ${ruleId}`, err as Error);
      return "skipped";
    }
  }
}

/**
 * Weekly just adds 7 days. Monthly moves to the next calendar month and
 * clamps to that month's last day if `anchorDay` overflows it (e.g. a
 * "31st" rule in a 30-day month runs on the 30th) — never skips a month
 * outright, which a naive setDate(anchorDay) risks by rolling into the
 * month after next.
 */
function advance(from: Date, interval: RecurrenceInterval, anchorDay: number): Date {
  if (interval === "weekly") {
    return new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  const daysInNextMonth = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(anchorDay, daysInNextMonth));
  next.setUTCHours(from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds());
  return next;
}
