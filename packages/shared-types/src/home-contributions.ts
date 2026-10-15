import { z } from "zod";

/**
 * «Вклад» в дела дома: кто сколько закрыл. Единственная реализация расчёта — `buildContributions`;
 * сервер собирает сырые строки и зовёт её, клиент ничего не складывает сам.
 *
 * «Сделал» = тот, кто перевёл дело в `done` (журнал TaskActivity), а не тот, кому оно назначено:
 * назначенный и реальный исполнитель — разные вопросы, поэтому `takenOver` («взял чужое») считается
 * отдельно. Дело без известного исполнителя (закрыто до журнала, агентом, вышедшим участником) идёт в
 * `undetermined` и входит в общий знаменатель — доли всегда в сумме дают 1, ничего не «растворяется».
 */
export const CONTRIBUTION_PERIODS = ["week", "month", "quarter"] as const;
export const contributionPeriodSchema = z.enum(CONTRIBUTION_PERIODS);
export type ContributionPeriod = z.infer<typeof contributionPeriodSchema>;

export const CONTRIBUTION_PERIOD_DAYS: Record<ContributionPeriod, number> = { week: 7, month: 30, quarter: 90 };
export const CONTRIBUTION_PERIOD_LABEL: Record<ContributionPeriod, string> = { week: "7 дней", month: "30 дней", quarter: "90 дней" };

export const memberContributionSchema = z.object({
  userId: z.string(),
  name: z.string(),
  /** Закрыто дел за период. */
  done: z.number().int(),
  /** Из них — назначено ему или никому. */
  doneOwn: z.number().int(),
  /** Из них — назначено другому участнику («взял чужое»). */
  takenOver: z.number().int(),
  /** Доля закрытых дел от всех закрытых за период, включая неопределённых (0..1). */
  share: z.number(),
  /** Минуты по закрытым делам: фактическое время, иначе оценка. */
  minutes: z.number().int(),
  /** Доля минут от всех известных минут за период (0..1); 0, если минут нет ни у кого. */
  minutesShare: z.number(),
  /** Открытых дел, назначенных ему сейчас. */
  openAssigned: z.number().int(),
  /** Из них просрочено. */
  overdue: z.number().int()
});
export type MemberContribution = z.infer<typeof memberContributionSchema>;

export const contributionWeekSchema = z.object({
  /** Понедельник недели, `YYYY-MM-DD` (UTC). */
  start: z.string(),
  counts: z.record(z.string(), z.number().int()),
  undetermined: z.number().int()
});
export type ContributionWeek = z.infer<typeof contributionWeekSchema>;

export const homeContributionsSchema = z.object({
  period: contributionPeriodSchema,
  from: z.string(),
  to: z.string(),
  /** Все закрытые за период дела, включая неопределённых. */
  totalDone: z.number().int(),
  /** Закрытые дела без известного исполнителя. */
  undetermined: z.number().int(),
  /** Открытые дела дома, которые никому не назначены. */
  openUnassigned: z.number().int(),
  /** Сумма известных минут за период; 0 — режим «Время» ничего не покажет. */
  totalMinutes: z.number().int(),
  members: z.array(memberContributionSchema),
  weeks: z.array(contributionWeekSchema)
});
export type HomeContributions = z.infer<typeof homeContributionsSchema>;

export interface ContributionTask {
  status: string;
  completedAt: string | null;
  dueAt: string | null;
  /** Пользователь (не членство), которому назначено дело. */
  assigneeUserId: string | null;
  /** Пользователь, который последним перевёл дело в `done`; null — неизвестно. */
  closerUserId: string | null;
  /** Фактические минуты, иначе оценка; null — не известно. */
  minutes: number | null;
}

export interface BuildContributionsInput {
  period: ContributionPeriod;
  now: Date;
  members: Array<{ userId: string; name: string }>;
  tasks: ContributionTask[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Понедельник (UTC) недели, в которую попадает момент, как `YYYY-MM-DD`. */
export function contributionWeekStart(at: Date): string {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

export function buildContributions({ period, now, members, tasks }: BuildContributionsInput): HomeContributions {
  const to = now;
  const from = new Date(now.getTime() - CONTRIBUTION_PERIOD_DAYS[period] * DAY_MS);
  const known = new Map(members.map((m) => [m.userId, m]));

  const acc = new Map(
    members.map((m) => [m.userId, { done: 0, doneOwn: 0, takenOver: 0, minutes: 0, openAssigned: 0, overdue: 0 }])
  );
  let totalDone = 0;
  let undetermined = 0;
  let openUnassigned = 0;
  let totalMinutes = 0;

  // Недели от понедельника первой даты окна до недели «сейчас» — пустые тоже видны.
  const weeks = new Map<string, { counts: Record<string, number>; undetermined: number }>();
  for (let t = new Date(`${contributionWeekStart(from)}T00:00:00.000Z`).getTime(); t <= to.getTime(); t += 7 * DAY_MS) {
    weeks.set(new Date(t).toISOString().slice(0, 10), { counts: {}, undetermined: 0 });
  }

  for (const task of tasks) {
    if (task.status === "done") {
      const completed = task.completedAt ? new Date(task.completedAt) : null;
      if (!completed || completed < from || completed > to) continue;
      totalDone += 1;
      const week = weeks.get(contributionWeekStart(completed));
      const closer = task.closerUserId ? acc.get(task.closerUserId) : undefined;
      if (!closer || !task.closerUserId) {
        undetermined += 1;
        if (week) week.undetermined += 1;
        continue;
      }
      closer.done += 1;
      if (task.assigneeUserId && task.assigneeUserId !== task.closerUserId && known.has(task.assigneeUserId)) closer.takenOver += 1;
      else closer.doneOwn += 1;
      if (task.minutes !== null) {
        closer.minutes += task.minutes;
        totalMinutes += task.minutes;
      }
      if (week) week.counts[task.closerUserId] = (week.counts[task.closerUserId] ?? 0) + 1;
    } else if (task.status !== "canceled") {
      const holder = task.assigneeUserId ? acc.get(task.assigneeUserId) : undefined;
      if (!holder) {
        if (!task.assigneeUserId) openUnassigned += 1;
        continue;
      }
      holder.openAssigned += 1;
      if (task.dueAt && new Date(task.dueAt) < now) holder.overdue += 1;
    }
  }

  return {
    period,
    from: from.toISOString(),
    to: to.toISOString(),
    totalDone,
    undetermined,
    openUnassigned,
    totalMinutes,
    members: members
      .map((m) => {
        const a = acc.get(m.userId)!;
        return {
          userId: m.userId,
          name: m.name,
          ...a,
          share: totalDone === 0 ? 0 : a.done / totalDone,
          minutesShare: totalMinutes === 0 ? 0 : a.minutes / totalMinutes
        };
      })
      .sort((x, y) => y.done - x.done || x.name.localeCompare(y.name, "ru")),
    weeks: [...weeks.entries()].map(([start, w]) => ({ start, counts: w.counts, undetermined: w.undetermined }))
  };
}
