"use client";

import { formatDuration, summarizeByAuthorship } from "@orion/shared-types";
import { PanelSection, StatCard } from "@orion/ui";
import { useMemo } from "react";
import type { TimeInsightsSlotProps } from "../../lib/extensions/contracts";
import { TimeDynamics } from "./time-charts";

/**
 * Plugin `time-insights`: the «Итоги» block (today / 7 days / all, my-vs-team split, per-project
 * totals) and the «Динамика» charts. Money shown in them is the `time-billing` plugin's job — it
 * reaches this block through `billing`, which the host passes only when that plugin is on.
 */
export function TimeInsights({
  workspaceId,
  allProjects,
  projectNames,
  entries,
  summary,
  ratesKnown,
  projectsOn,
  headline,
  billing
}: TimeInsightsSlotProps): React.ReactElement {
  // Разрез «мои / команда / автор неизвестен» — по уже загруженной странице
  // (как и «По проектам» ниже), а не отдельный серверный агрегат: то же
  // допущение, что и у project totals, отдельного эндпоинта для него нет.
  const authorship = useMemo(() => summarizeByAuthorship(entries), [entries]);
  // Соло-пространство почти всегда даёт team=0/unknown=0 — тогда разрез не
  // несёт информации и просто дублирует «Всего», поэтому его прячем.
  const showAuthorship = authorship.teamMinutes > 0 || authorship.unknownAuthorMinutes > 0;

  return (
    <>
      <PanelSection title="Итоги">
        <div className="grid grid-cols-3 gap-2">
          <StatCard label="Сегодня" value={headline.today !== undefined ? formatDuration(headline.today) : "…"} />
          <StatCard label="7 дней" value={headline.week !== undefined ? formatDuration(headline.week) : "…"} />
          <StatCard label="Всего" value={headline.total !== undefined ? formatDuration(headline.total) : "…"} />
        </div>

        {showAuthorship ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-subtle-foreground">
            <span>
              Мои: <span className="font-mono tabular-nums text-foreground">{formatDuration(authorship.mineMinutes)}</span>
            </span>
            <span>
              Команда: <span className="font-mono tabular-nums text-foreground">{formatDuration(authorship.teamMinutes)}</span>
            </span>
            {authorship.unknownAuthorMinutes > 0 ? (
              <span>
                Автор неизвестен:{" "}
                <span className="font-mono tabular-nums text-foreground">{formatDuration(authorship.unknownAuthorMinutes)}</span>
              </span>
            ) : null}
          </div>
        ) : null}

        {billing ? <billing.SummaryCosts summary={summary} ratesKnown={ratesKnown} projectsOn={projectsOn} /> : null}

        {summary.projectTotals.length > 0 ? (
          <div className="space-y-1">
            <p className="text-2xs text-subtle-foreground">По проектам</p>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {summary.projectTotals.map((item) => (
                <li key={item.projectId} className="flex items-center justify-between gap-3 px-3 py-row">
                  <span className="min-w-0 truncate text-body text-foreground">
                    {projectNames.get(item.projectId) ?? "Проект"}
                    {billing ? <billing.ProjectMark item={item} summary={summary} /> : null}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="font-mono text-micro tabular-nums text-muted-foreground">{formatDuration(item.minutes)}</span>
                    {billing ? <billing.ProjectCost item={item} ratesKnown={ratesKnown} /> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </PanelSection>

      <TimeDynamics workspaceId={workspaceId} projects={allProjects} />
    </>
  );
}
