import { z } from "zod";
import { isIsoWeekKey } from "./planning";

/**
 * ORION v0.18 «Учёт времени» — see docs/HISTORY.md.
 *
 * One entry is a stretch of work: `startedAt` plus `endedAt`, where a null
 * `endedAt` means the timer is running *right now*. Duration is never stored —
 * it is derived on both sides through `entryMinutes` below, so a running timer
 * needs no writes while it ticks.
 *
 * Задание 04 добавляет к этому паузу (`pausedSeconds`/`pausedAt`), отметку
 * ручной корректировки (`editedAt`) с журналом правок и недельный план
 * (`TimePlan`). Длительность по-прежнему одна на всех — `entryMinutes`.
 */

/** Одна ручная правка записи: что, с чего и на что изменили. */
export const timeEntryEditSchema = z.object({
  at: z.string(),
  field: z.enum(["startedAt", "endedAt", "taskId", "projectId", "note"]),
  from: z.string().nullable(),
  to: z.string().nullable()
});
export type TimeEntryEdit = z.infer<typeof timeEntryEditSchema>;

/** Сколько последних правок хранится в самой записи (аудит без отдельной таблицы). */
export const TIME_ENTRY_EDIT_LOG_LIMIT = 20;

export const timeEntrySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  /**
   * The actor who worked this stretch. `null` means "unknown author" — a
   * legacy row created before S06 introduced this column, NOT "nobody's".
   * Never auto-attributed to the workspace owner; see the migration note in
   * `apps/api/prisma/migrations/*_time_entries_actor/migration.sql`.
   */
  userId: z.string().nullable(),
  /** True when `userId` is the caller's own id — what "мои" filters key on. */
  mine: z.boolean(),
  /** Optional: time can be tracked against a project without a specific task. */
  taskId: z.string().nullable(),
  /** Denormalised from the task when it isn't given explicitly (the panel sums by project). */
  projectId: z.string().nullable(),
  note: z.string(),
  startedAt: z.string(),
  /** Null = running. */
  endedAt: z.string().nullable(),
  /** Накопленная пауза в секундах; вычитается из длительности. */
  pausedSeconds: z.number().int(),
  /** Не null = таймер стоит на паузе (идёт, но время не капает). */
  pausedAt: z.string().nullable(),
  /** Не null = запись правили руками после создания (флаг для интерфейса и отчётов). */
  editedAt: z.string().nullable(),
  /** Последние правки, новее сверху; ограничено `TIME_ENTRY_EDIT_LOG_LIMIT`. */
  edits: z.array(timeEntryEditSchema),
  /** Minutes worked as of the response: for a running entry, up to "now" (what the client then ticks on its own). */
  minutes: z.number().int(),
  running: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type TimeEntry = z.infer<typeof timeEntrySchema>;

/**
 * A cursor page of entries, newest first. `nextCursor` is the last row's id
 * to pass back as `cursor` for the next page, or `null` when there is no
 * more. See `TimeSummary` for exact totals — the point of the split is that
 * `items` can legitimately be a small window while `minutes`/`count` still
 * describe the whole matching set (S15).
 */
export const timeEntryPageSchema = z.object({
  items: z.array(timeEntrySchema),
  nextCursor: z.string().nullable()
});
export type TimeEntryPage = z.infer<typeof timeEntryPageSchema>;

/**
 * Server-computed totals for a filter set — a real SQL aggregation, not a
 * sum over whatever page the client happens to have loaded (S15: the panel
 * used to silently undercount past the old 500-row list cap).
 */
export const timeSummarySchema = z.object({
  minutes: z.number().int(),
  count: z.number().int()
});
export type TimeSummary = z.infer<typeof timeSummarySchema>;

/**
 * Buckets `entryMinutes` sums into "мои" / "команда" / "автор неизвестен"
 * instead of one flat total — a legacy row without a known author must never
 * be silently folded into either a person's or "everyone else's" total (see
 * S06: unknown-rate is `null` not `0`, same discipline here for authorship).
 */
export interface TimeAuthorshipTotals {
  mineMinutes: number;
  teamMinutes: number;
  unknownAuthorMinutes: number;
}

export function summarizeByAuthorship(entries: readonly TimeEntry[]): TimeAuthorshipTotals {
  let mineMinutes = 0;
  let teamMinutes = 0;
  let unknownAuthorMinutes = 0;
  for (const entry of entries) {
    if (entry.userId === null) unknownAuthorMinutes += entry.minutes;
    else if (entry.mine) mineMinutes += entry.minutes;
    else teamMinutes += entry.minutes;
  }
  return { mineMinutes, teamMinutes, unknownAuthorMinutes };
}

/** Something with a start and an optional end — enough to measure, without requiring a full DTO. */
export interface MeasurableInterval {
  startedAt: string;
  endedAt: string | null;
  /** Накопленная пауза, секунды (задание 04). Отсутствует у старых вызывающих — считается 0. */
  pausedSeconds?: number | null;
  /** Идёт пауза с этого момента: длительность замирает, пока её не снимут. */
  pausedAt?: string | null;
}

/**
 * Minutes between `startedAt` and `endedAt` (or `now` while running), rounded
 * to whole minutes and never negative. The API uses it for the DTO's `minutes`
 * and the client re-runs it every second for the live timer — one definition of
 * "how long", so the running value can't disagree with the stored one.
 *
 * Пауза вычитается здесь же: иначе «минуты» таймера разошлись бы с тем, что
 * записано в отчёте. Пока пауза идёт (`pausedAt`), её длительность считается
 * до `end` — то есть до «сейчас» для запущенной записи: секундомер замирает.
 */
export function entryMinutes(entry: MeasurableInterval, now: Date = new Date()): number {
  const start = new Date(entry.startedAt).getTime();
  const end = entry.endedAt ? new Date(entry.endedAt).getTime() : now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const pausedSeconds = Math.max(0, entry.pausedSeconds ?? 0);
  const pausedAt = entry.pausedAt ? new Date(entry.pausedAt).getTime() : null;
  const currentPause = pausedAt !== null && Number.isFinite(pausedAt) ? Math.max(0, end - pausedAt) / 1000 : 0;
  const workedSeconds = (end - start) / 1000 - pausedSeconds - currentPause;
  return Math.max(0, Math.round(workedSeconds / 60));
}

/** "2 ч 05 мин" / "45 мин" — the one place time is rendered as text, shared by every panel. */
export function formatDuration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (hours === 0) return `${rest} мин`;
  if (rest === 0) return `${hours} ч`;
  return `${hours} ч ${String(rest).padStart(2, "0")} мин`;
}

/** `YYYY-MM-DD` of an ISO instant — the grouping key for "по дням". */
export function timeEntryDay(entry: MeasurableInterval, timeZone: string | null = null): string {
  void timeZone; // Grouping is by UTC day; a per-user zone would need the whole panel to agree on one.
  return entry.startedAt.slice(0, 10);
}

/**
 * Cost of a stretch of work: `minutes` at `hourlyRateMinor` (kopecks per hour,
 * the unit `Project.hourlyRate` uses), rounded to whole kopecks.
 *
 * Returns `null` when the rate is unknown (`null`/`undefined`) — deliberately
 * not 0. "We don't know the rate" and "the rate is zero" are different claims,
 * and a total that silently adds zeros would understate the real figure while
 * looking authoritative. Callers sum only the non-null parts and say so.
 */
export function timeCostMinor(minutes: number, hourlyRateMinor: number | null | undefined): number | null {
  if (hourlyRateMinor === null || hourlyRateMinor === undefined) return null;
  return Math.round((Math.max(0, minutes) / 60) * hourlyRateMinor);
}

export const startTimerInputSchema = z.object({
  taskId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  note: z.string().max(2_000).default("")
});
export type StartTimerInput = z.infer<typeof startTimerInputSchema>;

export const stopTimerInputSchema = z.object({
  /** ISO instant to stop at; omitted = now. Lets the UI "stop at" a rounded time. */
  at: z.string().datetime().nullable().optional()
});
export type StopTimerInput = z.infer<typeof stopTimerInputSchema>;

export const createTimeEntryInputSchema = z.object({
  taskId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  note: z.string().max(2_000).default(""),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime()
});
export type CreateTimeEntryInput = z.infer<typeof createTimeEntryInputSchema>;

/**
 * A PATCH is partial, so the "end after start" rule is checked in
 * `TimeService` against the record merged with the input — a standalone schema
 * only ever sees half of the picture (same reasoning as `assertTransactionShape`
 * for finance, see finance-refs.util.ts).
 */
export const updateTimeEntryInputSchema = z.object({
  taskId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  note: z.string().max(2_000).optional(),
  startedAt: z.string().datetime().optional(),
  /** `null` restarts the entry (used by "продолжить"), and the DB allows only one running row per workspace. */
  endedAt: z.string().datetime().nullable().optional()
});
export type UpdateTimeEntryInput = z.infer<typeof updateTimeEntryInputSchema>;

/**
 * Переключение между задачами (задание 04): старт нового таймера закрывает
 * прежний. Отдельный маршрут, а не изменение `start`: у `start` есть обещание
 * «второй таймер того же человека — 409», на котором держится защита от гонки
 * двух вкладок (S06). Переключение — осознанное действие, которое это
 * обещание не ломает.
 */
export const switchTimerInputSchema = startTimerInputSchema.extend({
  /** Момент закрытия прежней записи; по умолчанию «сейчас». */
  at: z.string().datetime().nullable().optional()
});
export type SwitchTimerInput = z.infer<typeof switchTimerInputSchema>;

export const switchTimerResultSchema = z.object({
  /** Закрытая запись или null, если до переключения таймер не шёл. */
  stopped: timeEntrySchema.nullable(),
  started: timeEntrySchema
});
export type SwitchTimerResult = z.infer<typeof switchTimerResultSchema>;

// --- недельный план времени -------------------------------------------------

/**
 * План на неделю — отдельная от задач сущность: «на этой неделе я планирую
 * 30 часов». Оценки самих задач (`Task.estimatedMinutes`) остаются планом по
 * задаче; складывать одно с другим молча нельзя, поэтому в аналитике они идут
 * разными полями.
 */
export const timePlanSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  /** ISO-неделя `2026-W45` (UTC), см. `isoWeekKey`/`isoWeekRange`. */
  week: z.string(),
  plannedMinutes: z.number().int(),
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type TimePlan = z.infer<typeof timePlanSchema>;

export const setTimePlanInputSchema = z.object({
  /** 0 — «на эту неделю план не отличается от обычной»; верхняя граница — 7 суток. */
  plannedMinutes: z.number().int().min(0).max(10_080),
  note: z.string().max(1_000).default("")
});
export type SetTimePlanInput = z.infer<typeof setTimePlanInputSchema>;

// --- аналитика план/факт ----------------------------------------------------

export const timeAnalyticsTaskPlanSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  /** Оценка задачи; `null` — не оценена (это не «ноль»). */
  estimatedMinutes: z.number().int().nullable(),
  actualMinutes: z.number().int(),
  /** `estimatedMinutes - actualMinutes`; `null`, если оценки нет. */
  remainingMinutes: z.number().int().nullable(),
  overrun: z.boolean()
});
export type TimeAnalyticsTaskPlan = z.infer<typeof timeAnalyticsTaskPlanSchema>;

export const timeAnalyticsWeekPlanSchema = z.object({
  week: z.string(),
  /** `null` — план на неделю не задан (не ноль). */
  plannedMinutes: z.number().int().nullable(),
  actualMinutes: z.number().int()
});
export type TimeAnalyticsWeekPlan = z.infer<typeof timeAnalyticsWeekPlanSchema>;

export const timeAnalyticsSchema = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
  projectId: z.string().nullable(),
  totals: z.object({
    minutes: z.number().int(),
    count: z.number().int(),
    /** Время, привязанное к задаче. */
    linkedMinutes: z.number().int(),
    /** Свободный секундомер: записи без задачи — это законный сценарий, не «ошибка заполнения». */
    freeMinutes: z.number().int()
  }),
  byProject: z.array(
    z.object({
      projectId: z.string().nullable(),
      minutes: z.number().int(),
      count: z.number().int()
    })
  ),
  byTask: z.array(
    z.object({
      taskId: z.string().nullable(),
      minutes: z.number().int(),
      count: z.number().int()
    })
  ),
  plan: z.object({
    /** Сумма оценок только по оценённым задачам; `null` — ни одна не оценена. */
    estimatedMinutes: z.number().int().nullable(),
    estimatedTaskCount: z.number().int(),
    unknownEstimateTaskCount: z.number().int(),
    tasks: z.array(timeAnalyticsTaskPlanSchema),
    weeks: z.array(timeAnalyticsWeekPlanSchema)
  })
});
export type TimeAnalytics = z.infer<typeof timeAnalyticsSchema>;

/** Ключ недели для пути: `2026-W45`. Отдельная схема, чтобы 400 был понятным. */
export const weekKeyParamSchema = z.string().refine(isIsoWeekKey, "Ожидается неделя вида 2026-W45");
