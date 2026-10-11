import { entryMinutes, timeCostMinor, timeEntryDay, type Project, type TimeEntry } from "@orion/shared-types";

/**
 * Pure client-side aggregation for the time panel. Everything is computed from
 * the already-loaded list (the same choice the other panels make — there is no
 * server-side totals endpoint by design, see docs/HISTORY.md v0.18), so these
 * helpers take `now` explicitly instead of reading the clock: the running entry
 * is part of every total and has to grow with the panel's local tick.
 *
 * Стоимость (v0.19) нужна ещё и список проектов — ставка живёт в проекте, —
 * поэтому `summariseEntries` принимает его и вместе с деньгами возвращает
 * минуты, которые оценить не удалось (см. `unratedMinutes`).
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const clock = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });

/** The day key of an instant — the same helper the grouping uses, so "Сегодня" can never disagree with the groups. */
function dayKeyOf(date: Date): string {
  return timeEntryDay({ startedAt: date.toISOString(), endedAt: null });
}

export interface TimeProjectTotal {
  projectId: string;
  /** Копейки за час (`Project.hourlyRate`); null = ставка не задана. */
  hourlyRateMinor: number | null;
  /** Валюта проекта — стоимость форматируется ею, а не валютой пространства. */
  currency: string;
  minutes: number;
  /**
   * `timeCostMinor(minutes, hourlyRateMinor)`: null, когда ставка неизвестна.
   * Ноль здесь значил бы «работа бесплатна», а это другое утверждение.
   */
  costMinor: number | null;
}

/**
 * Деньги по одной валюте. Итог считается отдельно на каждую валюту: ставки
 * лежат в валюте проекта, а складывать копейки разных валют — выдумывать курс,
 * которого в ORION нет.
 */
export interface TimeCostTotal {
  currency: string;
  costMinor: number;
  /** Минуты, из которых получился `costMinor`. */
  minutes: number;
}

export interface TimeSummary {
  /**
   * Minutes started today/within 7 days/overall, computed from the loaded
   * pages — used only for project/currency breakdowns below. `TimePanel`
   * shows the headline "Сегодня"/"7 дней"/"Всего" figures from
   * `useTimeEntriesSummary` (a real server-side aggregate) instead, so they
   * stay exact regardless of how many pages have been fetched (S15).
   */
  today: number;
  week: number;
  total: number;
  /** Every project with time, most minutes first; an entry with no project is not counted anywhere. */
  projectTotals: TimeProjectTotal[];
  /** Стоимость оценённой части, по валютам (пусто = оценивать нечего). */
  costs: TimeCostTotal[];
  /** Минуты, попавшие в `costs` (у проекта со временем была ставка). */
  ratedMinutes: number;
  /**
   * Минуты, о стоимости которых сказать нечего: у проекта нет ставки либо у
   * записи нет проекта вовсе. Панель обязана показать их отдельно — иначе итог
   * выглядел бы полным, молча недосчитав эти часы.
   */
  unratedMinutes: number;
}

export function summariseEntries(entries: TimeEntry[], projects: Project[], now: Date): TimeSummary {
  const todayKey = dayKeyOf(now);
  const weekAgo = now.getTime() - WEEK_MS;
  const byProject = new Map<string, number>();
  const projectsById = new Map(projects.map((project) => [project.id, project]));

  let today = 0;
  let week = 0;
  let total = 0;
  let noProjectMinutes = 0;

  for (const entry of entries) {
    const minutes = entryMinutes(entry, now);
    total += minutes;
    if (timeEntryDay(entry) === todayKey) today += minutes;
    if (new Date(entry.startedAt).getTime() >= weekAgo) week += minutes;
    // `projectId` is denormalised server-side (from the task when it isn't
    // given explicitly), so this is a plain group-by and not a task join.
    if (entry.projectId) byProject.set(entry.projectId, (byProject.get(entry.projectId) ?? 0) + minutes);
    else noProjectMinutes += minutes;
  }

  const projectTotals: TimeProjectTotal[] = [...byProject.entries()]
    .map(([projectId, minutes]) => {
      // A project missing from the list (not loaded, or another workspace's id
      // that shouldn't be here) means an unknown rate, never a free one.
      const project = projectsById.get(projectId);
      const hourlyRateMinor = project?.hourlyRate ?? null;
      return {
        projectId,
        hourlyRateMinor,
        currency: project?.currency ?? "RUB",
        minutes,
        costMinor: timeCostMinor(minutes, hourlyRateMinor)
      };
    })
    .sort((a, b) => b.minutes - a.minutes);

  const byCurrency = new Map<string, TimeCostTotal>();
  let ratedMinutes = 0;
  let unratedMinutes = noProjectMinutes;

  for (const item of projectTotals) {
    if (item.costMinor === null) {
      unratedMinutes += item.minutes;
      continue;
    }
    ratedMinutes += item.minutes;
    const bucket = byCurrency.get(item.currency);
    if (bucket) {
      bucket.costMinor += item.costMinor;
      bucket.minutes += item.minutes;
    } else {
      byCurrency.set(item.currency, { currency: item.currency, costMinor: item.costMinor, minutes: item.minutes });
    }
  }

  const costs = [...byCurrency.values()].sort((a, b) => b.costMinor - a.costMinor);

  return { today, week, total, projectTotals, costs, ratedMinutes, unratedMinutes };
}

export interface TimeDayGroup {
  /** `YYYY-MM-DD` — the key `timeEntryDay` groups by (UTC days, see the contract). */
  day: string;
  minutes: number;
  entries: TimeEntry[];
}

/** Entries grouped per day, newest day first (`entries` is already newest-first from the API). */
export function groupEntriesByDay(entries: TimeEntry[], now: Date): TimeDayGroup[] {
  const groups = new Map<string, TimeDayGroup>();
  for (const entry of entries) {
    const day = timeEntryDay(entry);
    const minutes = entryMinutes(entry, now);
    const group = groups.get(day);
    if (group) {
      group.entries.push(entry);
      group.minutes += minutes;
    } else {
      groups.set(day, { day, minutes, entries: [entry] });
    }
  }
  return [...groups.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

/** "Сегодня" / "Вчера" / "6 сентября, ср". */
export function dayLabel(day: string, now: Date): string {
  if (day === dayKeyOf(now)) return "Сегодня";
  if (day === dayKeyOf(new Date(now.getTime() - 24 * 60 * 60 * 1000))) return "Вчера";
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "short",
    timeZone: "UTC"
  });
}

/** "10:15 — 12:40", or "10:15 — идёт" for the running entry. */
export function timeRange(entry: TimeEntry): string {
  const started = clock.format(new Date(entry.startedAt));
  if (entry.endedAt) return `${started} — ${clock.format(new Date(entry.endedAt))}`;
  return `${started} — идёт`;
}
