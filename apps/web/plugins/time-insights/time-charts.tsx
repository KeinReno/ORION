"use client";

import { useTimeEntries } from "@orion/core-react";
import { formatDuration, type Project } from "@orion/shared-types";
import { Button, PanelSection, SegmentedControl, Skeleton, cx } from "@orion/ui";
import { useEffect, useMemo, useState } from "react";
import { dailyTotals, localDayKey, periodStats, projectShares } from "../../lib/extensions/host-api";
import { projectSwatchColor } from "../../lib/extensions/host-api";

type Span = 7 | 14 | 30;
const SPAN_OPTIONS: { value: `${Span}`; label: string }[] = [
  { value: "7", label: "7 дней" },
  { value: "14", label: "14" },
  { value: "30", label: "30" }
];
const CHART_H = 96;
/** Loading is capped: a runaway account must not turn a chart into a hundred requests. */
const MAX_PAGES = 20;
const FALLBACK_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#f43f5e", "#38bdf8", "#a78bfa", "#fb923c", "#94a3b8"];
const WEEKDAY = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTH_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/**
 * Time at a glance: hours per day as bars, and how the period splits across projects.
 * Both read the same window of entries (loaded to the end, not just the first page — a sum
 * over "whatever pages happen to be loaded" is exactly what the totals above must never be),
 * and days are the person's local days. Drawn with plain elements, no chart library.
 */
export function TimeDynamics({
  workspaceId,
  projects
}: {
  workspaceId: string | undefined;
  projects: Project[];
}): React.ReactElement | null {
  const [span, setSpan] = useState<Span>(14);
  const from = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 29).toISOString();
  }, []);
  const query = useTimeEntries(workspaceId, { from });
  const { entries, hasNextPage, isFetchingNextPage, fetchNextPage, data } = query;

  // Pull every page of the window; the first one alone would silently under-draw a busy month.
  const pages = data?.pages.length ?? 0;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && pages < MAX_PAGES) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, pages, fetchNextPage]);

  const totals = useMemo(() => dailyTotals(entries, span), [entries, span]);
  const shares = useMemo(() => projectShares(entries, span), [entries, span]);
  const stats = useMemo(() => periodStats(totals), [totals]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  if (query.isLoading) {
    return (
      <PanelSection title="Динамика">
        <Skeleton className="h-32 w-full" />
      </PanelSection>
    );
  }
  if (query.isError) {
    return (
      <PanelSection title="Динамика">
        <div className="flex items-center gap-3 text-label text-muted-foreground">
          <span>Не удалось загрузить данные для графика.</span>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Повторить</Button>
        </div>
      </PanelSection>
    );
  }
  // Historical records may exist even when the chart's recent window is empty.
  if (entries.length === 0 || stats.total === 0) {
    return (
      <PanelSection title="Динамика">
        <p className="text-label text-subtle-foreground">
          {entries.length === 0
            ? "За последние 30 дней записей нет. Более ранние записи доступны ниже."
            : `За последние ${span} дней записей нет. Более ранние записи доступны ниже.`}
        </p>
      </PanelSection>
    );
  }

  const max = Math.max(...totals.map((d) => d.minutes), 1);
  const todayKey = localDayKey(new Date());
  const colorFor = (projectId: string | null, index: number): string =>
    (projectId ? projectSwatchColor(projectById.get(projectId)?.color) : undefined) ?? (projectId === null ? "#52525b" : FALLBACK_COLORS[index % FALLBACK_COLORS.length]!);
  const totalShared = shares.reduce((sum, s) => sum + s.minutes, 0);
  const everyLabel = span === 7 ? 1 : span === 14 ? 2 : 5;

  return (
    <PanelSection
      title="Динамика"
      actions={
        <SegmentedControl<`${Span}`>
          aria-label="Период"
          size="sm"
          value={`${span}`}
          onChange={(value) => setSpan(Number(value) as Span)}
          options={SPAN_OPTIONS}
        />
      }
    >
      <div
        role="img"
        aria-label={`Время по дням за ${span} дней: всего ${formatDuration(stats.total)}, рабочих дней ${stats.workedDays}`}
        className="flex items-end gap-1"
        style={{ height: CHART_H + 20 }}
      >
        {totals.map((day, index) => {
          const height = day.minutes === 0 ? 2 : Math.max(4, Math.round((day.minutes / max) * CHART_H));
          const isToday = day.key === todayKey;
          const weekend = day.day.getDay() === 0 || day.day.getDay() === 6;
          const label = `${WEEKDAY[day.day.getDay()]}, ${day.day.getDate()} ${MONTH_SHORT[day.day.getMonth()]}`;
          const showLabel = (totals.length - 1 - index) % everyLabel === 0;
          return (
            <div key={day.key} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${label}: ${day.minutes === 0 ? "без записей" : formatDuration(day.minutes)}`}>
              <div
                className={cx(
                  "w-full rounded-t-md transition-[height] duration-300",
                  day.minutes === 0 ? "bg-white/[0.06]" : isToday ? "bg-accent" : weekend ? "bg-accent/45" : "bg-accent/70"
                )}
                style={{ height }}
              />
              <span className={cx("h-4 whitespace-nowrap text-2xs leading-4", isToday ? "font-medium text-foreground" : "text-subtle-foreground")}>
                {showLabel ? (span === 7 ? WEEKDAY[day.day.getDay()] : day.day.getDate()) : ""}
              </span>
            </div>
          );
        })}
      </div>

      <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
        <Stat label="Всего" value={formatDuration(stats.total)} />
        <Stat label="В рабочий день" value={formatDuration(stats.averageWorked)} />
        <Stat label="Лучший день" value={stats.best ? `${formatDuration(stats.best.minutes)}` : "—"} hint={stats.best ? `${stats.best.day.getDate()} ${MONTH_SHORT[stats.best.day.getMonth()]}` : undefined} />
      </dl>

      {shares.length > 0 ? (
        <div className="mt-4 space-y-2">
          <p className="text-2xs text-subtle-foreground">По проектам за период</p>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/[0.06]" role="img" aria-label="Доли времени по проектам">
            {shares.map((share, index) => (
              <span
                key={share.projectId ?? "none"}
                className="h-full"
                style={{ width: `${(share.minutes / totalShared) * 100}%`, backgroundColor: colorFor(share.projectId, index) }}
                title={`${share.projectId ? (projectById.get(share.projectId)?.name ?? "Проект") : "Без проекта"}: ${formatDuration(share.minutes)}`}
              />
            ))}
          </div>
          <ul className="space-y-1">
            {shares.slice(0, 6).map((share, index) => (
              <li key={share.projectId ?? "none"} className="flex items-center gap-2 text-label">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colorFor(share.projectId, index) }} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {share.projectId ? (projectById.get(share.projectId)?.name ?? "Проект") : "Без проекта"}
                </span>
                <span className="shrink-0 font-mono text-micro tabular-nums text-muted-foreground">{formatDuration(share.minutes)}</span>
                <span className="w-9 shrink-0 text-right font-mono text-micro tabular-nums text-subtle-foreground">{share.percent}%</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasNextPage && pages >= MAX_PAGES ? (
        <p className="mt-2 text-micro text-subtle-foreground">Показана часть записей: график строится по загруженным данным.</p>
      ) : null}
    </PanelSection>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }): React.ReactElement {
  return (
    <div className="rounded-lg border border-border px-2 py-1.5">
      <dt className="text-2xs text-subtle-foreground">{label}</dt>
      <dd className="font-mono text-label tabular-nums text-foreground">{value}</dd>
      {hint ? <dd className="text-micro text-subtle-foreground">{hint}</dd> : null}
    </div>
  );
}
