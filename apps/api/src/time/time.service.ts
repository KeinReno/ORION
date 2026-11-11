import { ProjectReferences } from "../projects/public/project-references";
import { TaskIntegrationReader } from "../tasks/public/task-integration-reader";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  TIME_ENTRY_EDIT_LOG_LIMIT,
  entryMinutes,
  type CreateTimeEntryInput,
  type StartTimerInput,
  type StopTimerInput,
  type SwitchTimerInput,
  type SwitchTimerResult,
  type TimeEntry,
  type TimeEntryEdit,
  type TimeEntryPage,
  type TimeSummary,
  type UpdateTimeEntryInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { DomainEventBus } from "../domain-events/domain-event-bus";

export interface TimeFilters {
  /** ISO instants — the same windowing the calendar uses (`events?from&to`). */
  from?: string;
  to?: string;
  taskId?: string;
  projectId?: string;
}

/** `list()` pagination knobs — cursor is the previous page's last row id (see `nextCursor`). */
export interface TimePageOptions {
  cursor?: string;
  /** Clamped to `MAX_PAGE_SIZE`; defaults to `DEFAULT_PAGE_SIZE`. */
  limit?: number;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;

/**
 * ORION v0.18 «Учёт времени». Mirrors the notes/tasks shape: a workspace-scoped
 * resource, every method checks membership and runs inside `withUser`, DTOs are
 * assembled by hand at the bottom.
 *
 * Two rules worth knowing:
 *  - **One running timer per (workspace, user) — S06.** It is a composite
 *    partial unique index in the database (`(workspaceId, userId) WHERE
 *    endedAt IS NULL`, see the S06 migration), not just a check here, because
 *    two devices/tabs of the SAME user can press "Старт" at the same instant;
 *    the race lands on P2002 and is translated into a 409 rather than a 500.
 *    Two DIFFERENT users in the same workspace never collide — team and solo
 *    are equal-priority scenarios (CLAUDE.md), so A running a timer must not
 *    block B from starting theirs.
 *  - **`projectId` is denormalised from the task** when the caller doesn't pass
 *    one, so "hours per project" is a plain group-by instead of a join through
 *    every task.
 */
@Injectable()
export class TimeService {
  constructor(
    private readonly projectReferences: ProjectReferences,
    private readonly taskReader: TaskIntegrationReader,
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly events: DomainEventBus
  ) {}

  /**
   * Cursor-paginated, newest first. `startedAt` is not unique (manual entries
   * routinely share a minute), so the cursor is a composite tie-breaker —
   * `(startedAt, id)` both descending — not `startedAt` alone: id-only or
   * startedAt-only cursors silently skip or repeat rows whenever two entries
   * land on the same instant (S15 finding — the old `take: 500` cap not only
   * truncated silently past 500 rows, it also had no page-2 at all).
   *
   * A client-supplied cursor is resolved and checked against `workspaceId`
   * before use: a cursor id from another workspace must not let a caller page
   * into data outside it (see 10-BACKLOG.md S15 cross-workspace cursor rule).
   */
  async list(userId: string, workspaceId: string, filters: TimeFilters = {}, page: TimePageOptions = {}): Promise<TimeEntryPage> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const where: Prisma.TimeEntryWhereInput = { workspaceId };
      if (filters.taskId) where.taskId = filters.taskId;
      if (filters.projectId) where.projectId = filters.projectId;
      if (filters.from || filters.to) {
        where.startedAt = {
          ...(filters.from ? { gte: new Date(filters.from) } : {}),
          ...(filters.to ? { lt: new Date(filters.to) } : {})
        };
      }

      if (page.cursor) {
        const cursorRow = await tx.timeEntry.findUnique({
          where: { id: page.cursor },
          select: { id: true, workspaceId: true, startedAt: true }
        });
        // Not found, or belongs to a different workspace: reject rather than
        // silently ignore — a stale/foreign cursor must not resolve to "start
        // from the top" (that would look like a successful, if odd, page) nor
        // leak into another workspace's ordering.
        if (!cursorRow || cursorRow.workspaceId !== workspaceId) {
          throw new BadRequestException("Курсор пагинации недействителен для этого пространства");
        }
        where.OR = [
          { startedAt: { lt: cursorRow.startedAt } },
          { startedAt: cursorRow.startedAt, id: { lt: cursorRow.id } }
        ];
      }

      const limit = Math.min(Math.max(1, page.limit ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
      const rows = await tx.timeEntry.findMany({
        where,
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        take: limit + 1
      });
      const hasMore = rows.length > limit;
      const page_ = hasMore ? rows.slice(0, limit) : rows;
      return {
        items: page_.map((row) => toDto(row, userId)),
        nextCursor: hasMore ? page_[page_.length - 1]!.id : null
      };
    });
  }

  /**
   * Exact totals over every matching row, independent of `list()`'s page size —
   * S15: the panel used to sum whatever page it happened to have loaded, which
   * silently understated "Всего" past the old 500-row cap. This is a real SQL
   * aggregation (`SUM`/`COUNT`), not a client-side fold over a fetched window,
   * so it stays correct at any row count. Running entries (`endedAt IS NULL`)
   * count minutes up to `now()`, matching `entryMinutes()`'s own definition.
   */
  async summary(userId: string, workspaceId: string, filters: TimeFilters = {}): Promise<TimeSummary> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const conditions: Prisma.Sql[] = [Prisma.sql`"workspaceId" = ${workspaceId}`];
      if (filters.taskId) conditions.push(Prisma.sql`"taskId" = ${filters.taskId}`);
      if (filters.projectId) conditions.push(Prisma.sql`"projectId" = ${filters.projectId}`);
      // `time_entries.startedAt`/`endedAt` are `timestamp without time zone`
      // columns holding literal UTC wall-clock digits (Prisma's own
      // convention for this schema — every other query path goes through
      // Prisma's query engine, which applies that convention consistently).
      // A raw query does not: `node-postgres` binds a JS `Date` parameter as
      // `timestamptz`, and comparing that to a tz-less column makes Postgres
      // implicitly cast the parameter down to `timestamp` **using the
      // session's `timezone` GUC** — silently shifting the boundary by the
      // server's offset (found here as a real bug: Europe/Moscow, +3, made
      // `startedAt >= <UTC instant>` drop exactly the first 180 one-minute
      // rows of a fixture, i.e. 3 hours' worth, until this was cast right).
      // The fix is to bind ISO strings and cast them `::timestamp` — a
      // text→timestamp cast reads the digits literally, no zone involved —
      // and to normalize `now()` (itself `timestamptz`) the same way instead
      // of letting `COALESCE` promote the whole expression to `timestamptz`.
      if (filters.from) conditions.push(Prisma.sql`"startedAt" >= ${new Date(filters.from).toISOString()}::timestamp`);
      if (filters.to) conditions.push(Prisma.sql`"startedAt" < ${new Date(filters.to).toISOString()}::timestamp`);
      const where = Prisma.join(conditions, " AND ");

      const rows = await tx.$queryRaw<{ minutes: number | null; count: bigint }[]>(Prisma.sql`
        SELECT
          COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (COALESCE("endedAt", (now() AT TIME ZONE 'UTC')) - "startedAt")) / 60)), 0)::float8 AS minutes,
          COUNT(*)::bigint AS count
        FROM "time_entries"
        WHERE ${where}
      `);
      const row = rows[0];
      return {
        minutes: Math.round(row?.minutes ?? 0),
        count: Number(row?.count ?? 0n)
      };
    });
  }

  /** The caller's own running entry, if any — the panel's start/stop widget reads this. */
  async running(userId: string, workspaceId: string): Promise<TimeEntry | null> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.timeEntry.findFirst({ where: { workspaceId, userId, endedAt: null } });
    });
    return row ? toDto(row, userId) : null;
  }

  async start(userId: string, workspaceId: string, input: StartTimerInput): Promise<TimeEntry> {
    try {
      const row = await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
        // Scoped to this user: A running a timer must not block B from
        // starting theirs in the same workspace (team and solo are equal
        // priority scenarios, see CLAUDE.md). The DB's composite partial
        // unique index (workspaceId, userId) is the real authority below —
        // this is only the friendly pre-check for a same-tab double-click.
        const running = await tx.timeEntry.findFirst({
          where: { workspaceId, userId, endedAt: null },
          select: { id: true }
        });
        if (running) throw new ConflictException("Таймер уже запущен — остановите текущий");

        const task = await this.resolveTaskTx(tx, workspaceId, input.taskId ?? null);
        const projectId = await this.resolveProjectTx(tx, workspaceId, input.projectId ?? null, task?.projectId ?? null);

        return tx.timeEntry.create({
          data: {
            workspaceId,
            userId,
            taskId: task?.id ?? null,
            projectId,
            note: input.note ?? "",
            startedAt: new Date()
          }
        });
      });
      return toDto(row, userId);
    } catch (error) {
      // The DB index is the authority: two racing requests for the SAME user
      // (two tabs) land here instead of leaving two timers running. Two
      // DIFFERENT users racing each other never hit this index at all — the
      // index key includes userId — so both succeed, as they should.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Таймер уже запущен — остановите текущий");
      }
      throw error;
    }
  }

  async stop(userId: string, workspaceId: string, input: StopTimerInput = {}): Promise<TimeEntry> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      // Only the caller's own running timer — A must not be able to stop B's.
      const running = await tx.timeEntry.findFirst({ where: { workspaceId, userId, endedAt: null } });
      if (!running) throw new NotFoundException("Таймер не запущен");

      const endedAt = input.at ? new Date(input.at) : new Date();
      if (endedAt.getTime() <= running.startedAt.getTime()) {
        throw new BadRequestException("Конец должен быть позже начала");
      }
      // Остановка на паузе: незакрытая пауза сначала переносится в счётчик, иначе
      // её минуты молча вернулись бы в длительность записи.
      const pausedSeconds = accumulatedPausedSeconds(running, endedAt);
      const row = await tx.timeEntry.update({
        where: { id: running.id },
        data: { endedAt, pausedSeconds, pausedAt: null }
      });
      return toDto(row, userId);
    });
  }

  /**
   * Пауза (задание 04): таймер остаётся запущенным (`endedAt = null`), но время не
   * капает — `pausedAt` фиксирует момент, `entryMinutes` вычитает паузу. Отдельная
   * пара `pause`/`resume` вместо правки `startedAt`: так история не переписывается.
   */
  async pause(userId: string, workspaceId: string): Promise<TimeEntry> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const running = await tx.timeEntry.findFirst({ where: { workspaceId, userId, endedAt: null } });
      if (!running) throw new NotFoundException("Таймер не запущен");
      if (running.pausedAt) throw new ConflictException("Таймер уже на паузе");
      const row = await tx.timeEntry.update({ where: { id: running.id }, data: { pausedAt: new Date() } });
      return toDto(row, userId);
    });
  }

  async resume(userId: string, workspaceId: string): Promise<TimeEntry> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const running = await tx.timeEntry.findFirst({ where: { workspaceId, userId, endedAt: null } });
      if (!running) throw new NotFoundException("Таймер не запущен");
      if (!running.pausedAt) throw new ConflictException("Таймер не на паузе");
      const now = new Date();
      const row = await tx.timeEntry.update({
        where: { id: running.id },
        data: { pausedSeconds: accumulatedPausedSeconds(running, now), pausedAt: null }
      });
      return toDto(row, userId);
    });
  }

  /**
   * Переключение между задачами (задание 04): новый таймер закрывает прежний в
   * той же транзакции и публикует `time.entry.switched`. Отдельный маршрут, а не
   * новое поведение `start`: у `start` остаётся 409 на второй таймер того же
   * человека, на котором держится защита от гонки двух вкладок (S06).
   */
  async switchTimer(userId: string, workspaceId: string, input: SwitchTimerInput): Promise<SwitchTimerResult> {
    try {
      return await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
        const running = await tx.timeEntry.findFirst({ where: { workspaceId, userId, endedAt: null } });
        const at = input.at ? new Date(input.at) : new Date();
        let stopped: Awaited<ReturnType<typeof tx.timeEntry.update>> | null = null;
        if (running) {
          if (at.getTime() <= running.startedAt.getTime()) {
            throw new BadRequestException("Момент переключения должен быть позже начала текущего таймера");
          }
          stopped = await tx.timeEntry.update({
            where: { id: running.id },
            data: { endedAt: at, pausedSeconds: accumulatedPausedSeconds(running, at), pausedAt: null }
          });
        }
        const task = await this.resolveTaskTx(tx, workspaceId, input.taskId ?? null);
        const projectId = await this.resolveProjectTx(tx, workspaceId, input.projectId ?? null, task?.projectId ?? null);
        const started = await tx.timeEntry.create({
          data: {
            workspaceId,
            userId,
            taskId: task?.id ?? null,
            projectId,
            note: input.note ?? "",
            startedAt: at
          }
        });
        await this.events.publishTx(tx, {
          workspaceId,
          actorId: userId,
          type: "time.entry.switched",
          payload: { id: started.id, taskId: started.taskId, projectId: started.projectId, previousId: stopped?.id ?? null }
        });
        return { stopped: stopped ? toDto(stopped, userId) : null, started: toDto(started, userId) };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Таймер уже запущен — обновите состояние и повторите");
      }
      throw error;
    }
  }

  /** A manual entry — "я работал над этим вчера с 10 до 12". */
  async create(userId: string, workspaceId: string, input: CreateTimeEntryInput): Promise<TimeEntry> {
    assertRange(new Date(input.startedAt), new Date(input.endedAt));
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const task = await this.resolveTaskTx(tx, workspaceId, input.taskId ?? null);
      const projectId = await this.resolveProjectTx(tx, workspaceId, input.projectId ?? null, task?.projectId ?? null);
      return tx.timeEntry.create({
        data: {
          workspaceId,
          userId,
          taskId: task?.id ?? null,
          projectId,
          note: input.note ?? "",
          startedAt: new Date(input.startedAt),
          endedAt: new Date(input.endedAt)
        }
      });
    });
    return toDto(row, userId);
  }

  async update(
    userId: string,
    workspaceId: string,
    entryId: string,
    input: UpdateTimeEntryInput
  ): Promise<TimeEntry> {
    try {
      const row = await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
        const current = await this.assertOwnedTx(tx, workspaceId, entryId, userId);

        // Validate the *merged* picture: a PATCH touching only `note` must not
        // have to resend the whole entry just to pass the range check.
        const startedAt = input.startedAt ? new Date(input.startedAt) : current.startedAt;
        const endedAt =
          input.endedAt === undefined ? current.endedAt : input.endedAt === null ? null : new Date(input.endedAt);
        if (endedAt) assertRange(startedAt, endedAt);

        const taskId = input.taskId !== undefined ? input.taskId : current.taskId;
        const task = await this.resolveTaskTx(tx, workspaceId, taskId);
        const projectId = await this.resolveProjectTx(
          tx,
          workspaceId,
          input.projectId !== undefined ? input.projectId : current.projectId,
          task?.projectId ?? null
        );

        const note = input.note !== undefined ? input.note : current.note;
        const changes = collectEdits(current, { taskId: task?.id ?? null, projectId, note, startedAt, endedAt });
        const edits = [...changes, ...parseEdits(current.edits)].slice(0, TIME_ENTRY_EDIT_LOG_LIMIT);
        const row = await tx.timeEntry.update({
          where: { id: entryId },
          data: {
            taskId: task?.id ?? null,
            projectId,
            note: input.note,
            startedAt: input.startedAt ? startedAt : undefined,
            endedAt: input.endedAt === undefined ? undefined : endedAt,
            ...(changes.length ? { edits: edits as unknown as Prisma.InputJsonValue, editedAt: new Date() } : {})
          }
        });
        if (changes.length) {
          await this.events.publishTx(tx, {
            workspaceId,
            actorId: userId,
            type: "time.entry.edited",
            payload: { id: entryId, taskId: row.taskId, fields: changes.map((change) => change.field) }
          });
        }
        return row;
      });
      return toDto(row, userId);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Уже есть запущенный таймер — сначала остановите его");
      }
      throw error;
    }
  }

  /** One entry the caller may edit (their own or an author-unknown legacy one) — the same rule as update/remove. */
  async get(userId: string, workspaceId: string, entryId: string): Promise<TimeEntry> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return toDto(await this.assertOwnedTx(tx, workspaceId, entryId, userId), userId);
    });
  }

  async remove(userId: string, workspaceId: string, entryId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, entryId, userId);
      await tx.timeEntry.delete({ where: { id: entryId } });
    });
  }

  // --- helpers -------------------------------------------------------------

  /**
   * The ordinary edit/delete path is "your own entries" only — A must not be
   * able to silently rewrite B's hours. Author-unknown legacy rows (no
   * `userId` — see the S06 migration) are the one exception: nobody owns
   * them yet, and reassigning them to a specific person is an admin decision
   * this backlog card explicitly defers (see 12-PROGRESS.md), so any member
   * of the workspace may correct them through this same endpoint rather than
   * having stuck, unfixable rows.
   */
  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, entryId: string, userId: string) {
    const entry = await tx.timeEntry.findUnique({ where: { id: entryId } });
    if (!entry || entry.workspaceId !== workspaceId) throw new NotFoundException("Запись времени не найдена");
    if (entry.userId !== null && entry.userId !== userId) {
      throw new NotFoundException("Запись времени не найдена");
    }
    return entry;
  }

  /** A task link must be a task of this workspace (a user can be a member of several). */
  private async resolveTaskTx(tx: Prisma.TransactionClient, workspaceId: string, taskId: string | null) {
    if (!taskId) return null;
    const task = await this.taskReader.referenceTx(tx, workspaceId, taskId);
    if (!task) throw new NotFoundException("Задача не найдена");
    return task;
  }

  /** Explicit project wins; otherwise inherit the task's; otherwise none. */
  private async resolveProjectTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    projectId: string | null,
    inherited: string | null
  ): Promise<string | null> {
    const candidate = projectId ?? inherited;
    if (!candidate) return null;
    if (!(await this.projectReferences.existsTx(tx, workspaceId, candidate))) throw new NotFoundException("Проект не найден");
    return candidate;
  }
}

function assertRange(startedAt: Date, endedAt: Date): void {
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
    throw new BadRequestException("Некорректные даты");
  }
  if (endedAt.getTime() <= startedAt.getTime()) {
    throw new BadRequestException("Конец должен быть позже начала");
  }
}

type PausedRow = { pausedSeconds: number; pausedAt: Date | null };

/**
 * Накопленная пауза на момент `at`: закрытые паузы плюс текущая, если она открыта.
 * Одна функция на stop/resume/switch, чтобы «сколько уже на паузе» не считалось
 * тремя разными способами и не разъезжалось с `entryMinutes`.
 */
function accumulatedPausedSeconds(row: PausedRow, at: Date): number {
  const base = Math.max(0, row.pausedSeconds ?? 0);
  if (!row.pausedAt) return base;
  const current = Math.max(0, Math.round((at.getTime() - row.pausedAt.getTime()) / 1000));
  return base + current;
}

/** Журнал правок хранится в самой записи; повреждённое значение не должно ронять чтение. */
function parseEdits(value: Prisma.JsonValue | null): TimeEntryEdit[] {
  if (!Array.isArray(value)) return [];
  const out: TimeEntryEdit[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.field !== "string" || typeof record.at !== "string") continue;
    const field = record.field;
    if (!["startedAt", "endedAt", "taskId", "projectId", "note"].includes(field)) continue;
    out.push({
      at: record.at,
      field: field as TimeEntryEdit["field"],
      from: typeof record.from === "string" ? record.from : null,
      to: typeof record.to === "string" ? record.to : null
    });
  }
  return out;
}

/**
 * Что изменилось при ручной правке — «было → стало» по полям записи. Пишется в
 * журнал записи (не в TaskActivity: это аудит другой сущности) и уходит в событие
 * `time.entry.edited` только именами полей.
 */
function collectEdits(
  current: { startedAt: Date; endedAt: Date | null; taskId: string | null; projectId: string | null; note: string },
  next: { startedAt: Date; endedAt: Date | null; taskId: string | null; projectId: string | null; note: string }
): TimeEntryEdit[] {
  const at = new Date().toISOString();
  const changes: TimeEntryEdit[] = [];
  const compare = (field: TimeEntryEdit["field"], from: string | null, to: string | null): void => {
    if (from === to) return;
    changes.push({ at, field, from, to });
  };
  compare("startedAt", current.startedAt.toISOString(), next.startedAt.toISOString());
  compare("endedAt", current.endedAt ? current.endedAt.toISOString() : null, next.endedAt ? next.endedAt.toISOString() : null);
  compare("taskId", current.taskId, next.taskId);
  compare("projectId", current.projectId, next.projectId);
  compare("note", current.note, next.note);
  return changes;
}

function toDto(
  row: {
    id: string;
    workspaceId: string;
    userId: string | null;
    taskId: string | null;
    projectId: string | null;
    note: string;
    startedAt: Date;
    endedAt: Date | null;
    pausedSeconds: number;
    pausedAt: Date | null;
    editedAt: Date | null;
    edits: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  },
  callerId: string
): TimeEntry {
  const startedAt = row.startedAt.toISOString();
  const endedAt = row.endedAt ? row.endedAt.toISOString() : null;
  const pausedAt = row.pausedAt ? row.pausedAt.toISOString() : null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    mine: row.userId === callerId,
    taskId: row.taskId,
    projectId: row.projectId,
    note: row.note,
    startedAt,
    endedAt,
    pausedSeconds: row.pausedSeconds,
    pausedAt,
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    edits: parseEdits(row.edits),
    // Same helper the client ticks with, so a running entry's "minutes so far"
    // never disagrees between the API response and the panel. Пауза вычитается
    // внутри `entryMinutes`, а не здесь.
    minutes: entryMinutes({ startedAt, endedAt, pausedSeconds: row.pausedSeconds, pausedAt }),
    running: endedAt === null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
