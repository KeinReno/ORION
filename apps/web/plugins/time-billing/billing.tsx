"use client";

import { entryMinutes, formatDuration, timeCostMinor, type Project, type TimeEntry } from "@orion/shared-types";
import type { TimeBillingApi } from "../../lib/extensions/contracts";
import { formatMoney } from "../../lib/extensions/host-api";

/**
 * Plugin `time-billing`: everything that turns hours into money — the «Стоимость времени» lines
 * under the totals, the cost beside each project, the cost on each log row. Rates live on the
 * project (`Project.hourlyRate`); an unknown rate is shown as «—», never as 0 (see CLAUDE.md, v0.18).
 */
export const timeBillingApi: TimeBillingApi = {
  SummaryCosts({ summary, ratesKnown, projectsOn }) {
    const costs = ratesKnown ? summary.costs : [];
    const nothingPriced = ratesKnown && summary.costs.length === 0 && summary.total > 0;
    if (costs.length > 0) {
      return (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {costs.map((cost) => (
            <span key={cost.currency} className="flex items-baseline gap-1.5">
              <span className="text-2xs text-subtle-foreground">Стоимость времени:</span>
              <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                {formatMoney(cost.costMinor, cost.currency)}
                {summary.unratedMinutes > 0 ? (
                  <span className="text-label text-subtle-foreground" title="частично оценено">
                    *
                  </span>
                ) : null}
              </span>
            </span>
          ))}
          {summary.unratedMinutes > 0 ? (
            <span className="text-micro text-subtle-foreground">
              частично оценено: {formatDuration(summary.ratedMinutes)} из {formatDuration(summary.total)}
            </span>
          ) : null}
        </div>
      );
    }
    if (nothingPriced) {
      return (
        <p className="text-2xs text-subtle-foreground">
          {projectsOn
            ? "Стоимость не посчитана: у проектов со временем не задана ставка."
            : "Стоимость не посчитана: модуль «Проекты» выключен."}
        </p>
      );
    }
    return <></>;
  },

  ProjectMark({ item, summary }) {
    return item.costMinor !== null && summary.unratedMinutes > 0 ? (
      <span className="text-subtle-foreground" title="частично оценено">
        *
      </span>
    ) : (
      <></>
    );
  },

  ProjectCost({ item, ratesKnown }) {
    if (!ratesKnown) return <></>;
    return item.costMinor !== null ? (
      <span className="font-mono text-sm tabular-nums text-foreground">{formatMoney(item.costMinor, item.currency)}</span>
    ) : (
      <span className="font-mono text-micro tabular-nums text-subtle-foreground" title="Ставка не указана">
        —
      </span>
    );
  },

  entryCost(entry: TimeEntry, projects: Project[], now: Date) {
    const project = entry.projectId ? projects.find((item) => item.id === entry.projectId) : undefined;
    const cost = timeCostMinor(entryMinutes(entry, now), project?.hourlyRate ?? null);
    if (cost === null) return { text: "—", title: "Ставка не указана" };
    return { text: formatMoney(cost, project?.currency ?? "RUB") };
  }
};
