import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  habitDayDate,
  habitDayKey,
  habitStreak,
  isHabitScheduled,
  type CreateHabitInput,
  type Habit,
  type HabitEntry,
  type ToggleHabitInput,
  type ToggleHabitResult,
  type UpdateHabitInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

/** How far back the streak is allowed to look — ten years is well past any real streak, and it bounds the query. */
const STREAK_WINDOW_DAYS = 3_660;

export interface HabitEntryFilters {
  from?: string;
  to?: string;
}

/** `today` is the caller's own calendar day (`YYYY-MM-DD`), see `HabitsService.list`. */
export interface ListHabitsOptions {
  includeArchived?: boolean;
  today?: string;
}

/**
 * ORION v0.19 «Привычки». Mirrors notes/tasks: workspace-scoped, membership
 * checked first, everything inside `withUser`, DTOs assembled by hand.
 *
 * The per-habit numbers (`streak`, `dueToday`, `doneToday`) are **computed**,
 * not stored: a streak is a fact about the tick history and the schedule, and a
 * cached copy would go stale the moment a tick is toggled or the schedule
 * changes. The rules live in `@orion/shared-types` (`habitStreak`), so the
 * panel and the API can never disagree about what a streak means.
 */
@Injectable()
export class HabitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async list(userId: string, workspaceId: string, options: ListHabitsOptions = {}): Promise<Habit[]> {
    const { habits, entries, todayKey } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      // `today` comes from the client when it knows its own calendar day (the
      // panel always does): the server's UTC day would make `dueToday` and the
      // streak anchor wrong for anyone east or west of UTC for part of the day.
      // Without it, the server's own day is the fallback.
      const todayKey = options.today ?? habitDayKey(new Date());
      const since = habitDayDate(todayKey);
      since.setUTCDate(since.getUTCDate() - STREAK_WINDOW_DAYS);

      const [habits, entries] = await Promise.all([
        tx.habit.findMany({
          where: { workspaceId, ...(options.includeArchived ? {} : { archivedAt: null }) },
          orderBy: [{ createdAt: "asc" }]
        }),
        tx.habitEntry.findMany({
          where: { workspaceId, day: { gte: since } },
          select: { habitId: true, day: true }
        })
      ]);
      return { habits, entries, todayKey };
    });

    const doneByHabit = new Map<string, Set<string>>();
    for (const entry of entries) {
      const days = doneByHabit.get(entry.habitId) ?? new Set<string>();
      days.add(habitDayKey(entry.day));
      doneByHabit.set(entry.habitId, days);
    }
    return habits.map((habit) => toDto(habit, doneByHabit.get(habit.id) ?? new Set(), todayKey));
  }

  async create(userId: string, workspaceId: string, input: CreateHabitInput): Promise<Habit> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.habit.create({
        data: {
          workspaceId,
          name: input.name,
          note: input.note ?? "",
          weekdays: normaliseWeekdays(input.weekdays ?? []),
          color: input.color ?? null
        }
      });
    });
    return toDto(row, new Set(), habitDayKey(new Date()));
  }

  async update(userId: string, workspaceId: string, habitId: string, input: UpdateHabitInput): Promise<Habit> {
    const { row, done, todayKey } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, habitId);
      const row = await tx.habit.update({
        where: { id: habitId },
        data: {
          name: input.name,
          note: input.note,
          weekdays: input.weekdays ? normaliseWeekdays(input.weekdays) : undefined,
          color: input.color,
          archivedAt: input.archivedAt === undefined ? undefined : input.archivedAt === null ? null : new Date(input.archivedAt)
        }
      });
      const entries = await tx.habitEntry.findMany({ where: { habitId }, select: { day: true } });
      return { row, done: new Set(entries.map((entry) => habitDayKey(entry.day))), todayKey: habitDayKey(new Date()) };
    });
    return toDto(row, done, todayKey);
  }

  /**
   * Archiving, not deletion — same choice as projects (`DELETE /projects/:id`):
   * a habit carries a history of ticks, and "I stopped doing this" is not the
   * same as "erase that I ever did". Archived habits keep their entries and can
   * be restored by clearing `archivedAt`.
   */
  async archive(userId: string, workspaceId: string, habitId: string): Promise<Habit> {
    return this.update(userId, workspaceId, habitId, { archivedAt: new Date().toISOString() });
  }

  /**
   * Tick or untick one day. Toggling an off-schedule day is allowed (the
   * user did it, after all) but doesn't count towards the streak.
   *
   * This is check-then-act (read whether today's entry exists, then create
   * or delete), which is not safe to run twice concurrently without help:
   * two overlapping requests can both read "not ticked", both try to
   * create, and race on the unique `(habitId, day)` index (P2002) — or,
   * the mirror case, both read "ticked" and both try to delete, where the
   * loser's delete targets a row the winner already removed (P2025, not
   * P2002 — a plain "catch P2002" as this method used to do doesn't see
   * it, and it 500s). Worse than the 500: without serializing the two
   * reads, one request's create can be immediately undone by the other's
   * delete (each reading state from before the other committed), silently
   * losing a tap instead of just erroring on it.
   *
   * `SELECT ... FOR UPDATE` on the parent habit row serializes concurrent
   * toggles for the same habit (any day) the same way `InventoryService`
   * serializes concurrent movements on the same item: the second request's
   * read only happens after the first's write has committed and released
   * the lock, so it sees real state, not a stale snapshot. The P2002/P2025
   * catch stays as defense in depth — belt and suspenders, not the primary
   * fix — in case the lock is ever bypassed by a future code path.
   */
  async toggle(userId: string, workspaceId: string, habitId: string, input: ToggleHabitInput): Promise<ToggleHabitResult> {
    const dayKey = input.day ?? habitDayKey(new Date());
    try {
      return await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
        await this.assertOwnedTx(tx, workspaceId, habitId);
        await tx.$queryRaw`SELECT id FROM habits WHERE id = ${habitId} FOR UPDATE`;

        const existing = await tx.habitEntry.findUnique({
          where: { habitId_day: { habitId, day: habitDayDate(dayKey) } },
          select: { id: true }
        });
        if (existing) {
          await tx.habitEntry.delete({ where: { id: existing.id } });
          return { habitId, day: dayKey, done: false };
        }
        await tx.habitEntry.create({ data: { workspaceId, habitId, day: habitDayDate(dayKey) } });
        return { habitId, day: dayKey, done: true };
      });
    } catch (error) {
      // Two taps racing each other despite the row lock (shouldn't happen,
      // but a crash here is strictly worse than a slightly-stale answer):
      // treat a lost create race (P2002) as "already done", and a lost
      // delete race (P2025, the row was already removed by the winner) as
      // "already not done".
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") return { habitId, day: dayKey, done: true };
        if (error.code === "P2025") return { habitId, day: dayKey, done: false };
      }
      throw error;
    }
  }

  async entries(userId: string, workspaceId: string, filters: HabitEntryFilters = {}): Promise<HabitEntry[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const where: Prisma.HabitEntryWhereInput = { workspaceId };
      if (filters.from || filters.to) {
        where.day = {
          ...(filters.from ? { gte: habitDayDate(filters.from) } : {}),
          ...(filters.to ? { lte: habitDayDate(filters.to) } : {})
        };
      }
      return tx.habitEntry.findMany({ where, orderBy: [{ day: "asc" }], take: 5_000 });
    });
    return rows.map((row) => ({
      id: row.id,
      habitId: row.habitId,
      day: habitDayKey(row.day),
      createdAt: row.createdAt.toISOString()
    }));
  }

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, habitId: string) {
    const habit = await tx.habit.findUnique({ where: { id: habitId } });
    if (!habit || habit.workspaceId !== workspaceId) throw new NotFoundException("Привычка не найдена");
    return habit;
  }
}

/** Deduplicated and sorted, so the stored schedule is canonical (and diffable in tests). */
function normaliseWeekdays(weekdays: number[]): number[] {
  return [...new Set(weekdays)].sort((a, b) => a - b);
}

function toDto(
  habit: {
    id: string;
    workspaceId: string;
    name: string;
    note: string;
    weekdays: number[];
    color: string | null;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
  doneDays: Set<string>,
  todayKey: string
): Habit {
  return {
    id: habit.id,
    workspaceId: habit.workspaceId,
    name: habit.name,
    note: habit.note,
    weekdays: habit.weekdays,
    color: habit.color,
    archivedAt: habit.archivedAt ? habit.archivedAt.toISOString() : null,
    streak: habitStreak(habit.weekdays, doneDays, todayKey),
    dueToday: isHabitScheduled(habit.weekdays, todayKey),
    doneToday: doneDays.has(todayKey),
    createdAt: habit.createdAt.toISOString(),
    updatedAt: habit.updatedAt.toISOString()
  };
}
