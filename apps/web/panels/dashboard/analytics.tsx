"use client";

import { useActivity, useAgentAuditLog, useProjectGoals, useProjects } from "@orion/core-react";
import type { Task } from "@orion/shared-types";
import { PanelBody, PanelHeader, PanelShell, SloshGauge, StarBorder, cx } from "@orion/ui";
import { BarChart3 } from "lucide-react";
import { useMemo, useState } from "react";
import { SectionTabs, sectionTabTitle, useSectionView, type SectionTab } from "../../components/section-tabs";
import { shortDate } from "../../lib/format";
import { dailyFlow, featuredGoal, flowTotals, workload, type DayFlow } from "../../lib/dashboard-stats";
import { openEntity, openPanel, openProject, openSettings, showTasksFiltered } from "../../lib/panel-bus";
import type { PanelComponentProps } from "../../lib/panel-registry";
import { useEnabledModules } from "../../lib/use-enabled-modules";
import { useEnabledPlugins } from "../../lib/use-enabled-plugins";

type Mode = "personal" | "projects" | "goals" | "ai" | "activity";

const MODE_KEY = "orion.dashboard-analytics-mode";

function StatTile({ value, label, tone, onClick }: { value: number | string; label: string; tone?: "danger" | "warning"; onClick?: () => void }): React.ReactElement {
  const body = (
    <>
      <span className={cx("block font-mono text-xl tabular-nums", tone === "danger" && "text-destructive", tone === "warning" && "text-warning")}>{value}</span>
      <span className="block text-2xs text-subtle-foreground">{label}</span>
    </>
  );
  const className = "rounded-xl border border-border px-3 py-2 text-left";
  return onClick ? (
    <button type="button" onClick={onClick} className={cx(className, "transition-colors hover:bg-white/5")}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** Created vs. completed per day. Bars carry a text alternative below, so the figures are not colour-only. */
function FlowChart({ flow }: { flow: DayFlow[] }): React.ReactElement {
  const max = Math.max(1, ...flow.flatMap((day) => [day.created, day.completed]));
  const barW = 9;
  const gap = 4;
  const groupW = barW * 2 + gap;
  const slot = groupW + 8;
  const height = 96;
  const width = flow.length * slot;
  const totals = flowTotals(flow);
  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${width} ${height + 16}`} role="img" aria-label={`Создано ${totals.created}, выполнено ${totals.completed} за ${flow.length} дн.`} className="w-full max-w-xl">
        {flow.map((day, index) => {
          const x = index * slot + 4;
          const created = (day.created / max) * height;
          const completed = (day.completed / max) * height;
          return (
            <g key={day.key}>
              <title>{`${day.key}: создано ${day.created}, выполнено ${day.completed}`}</title>
              <rect x={x} y={height - created} width={barW} height={created} rx={2} className="fill-muted-foreground/50" />
              <rect x={x + barW + gap} y={height - completed} width={barW} height={completed} rx={2} className="fill-accent" />
              <text x={x + groupW / 2} y={height + 12} textAnchor="middle" className="fill-subtle-foreground text-[9px]">
                {day.label}
              </text>
            </g>
          );
        })}
        <line x1={0} x2={width} y1={height} y2={height} className="stroke-border" />
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 text-2xs text-subtle-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-muted-foreground/50" /> создано {totals.created}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-accent" /> выполнено {totals.completed}
        </span>
        <span>{totals.net > 0 ? `очередь выросла на ${totals.net}` : totals.net < 0 ? `очередь сократилась на ${-totals.net}` : "очередь не изменилась"}</span>
      </figcaption>
    </figure>
  );
}

function Bar({ value }: { value: number | null }): React.ReactElement {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}>
      {value === null ? null : <div className="h-full rounded-full bg-accent" style={{ width: `${value}%` }} />}
    </div>
  );
}

/**
 * Dashboard analytics: four views over the same data the panels use — personal workload,
 * projects, goals, AI agents. Every figure is a way into the list it counts (tile → Tasks,
 * row → the project / goals panel / agent log).
 */
export function DashboardAnalytics({
  workspaceId,
  tasks,
  now,
  params,
  api
}: {
  workspaceId: string | undefined;
  tasks: Task[];
  now: Date;
  /** Set when the analytics is opened as a view of ONE mode (`view:dashboard~<mode>`): only that mode, no strip. */
  params?: PanelComponentProps["params"];
  api?: PanelComponentProps["api"];
}): React.ReactElement {
  const { isEnabled } = useEnabledModules();
  const { isEnabled: isPluginEnabled } = useEnabledPlugins();
  const projectsOn = isEnabled("projects");
  const goalsOn = projectsOn && isPluginEnabled("projects-goals");

  const [mode, setMode] = useState<Mode>(() => {
    try {
      const saved = localStorage.getItem(MODE_KEY);
      return saved === "projects" || saved === "goals" || saved === "ai" || saved === "activity" ? saved : "personal";
    } catch {
      return "personal";
    }
  });
  function chooseMode(next: Mode): void {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* a remembered tab is a convenience only */
    }
  }

  const modes: SectionTab<Mode>[] = [
    { value: "personal", label: "Личный" },
    ...(projectsOn ? [{ value: "projects" as const, label: "Проекты" }] : []),
    ...(goalsOn ? [{ value: "goals" as const, label: "Цели" }] : []),
    { value: "activity", label: "Журнал" },
    { value: "ai", label: "ИИ" }
  ];
  const section = useSectionView(params, api, "Дашборд", modes);
  const active: Mode = section.view ?? (modes.some((m) => m.value === mode) ? mode : "personal");

  const { data: projects } = useProjects(projectsOn && active === "projects" ? workspaceId : undefined);
  const { data: goals } = useProjectGoals(goalsOn && active === "goals" ? workspaceId : undefined);
  const { data: activity } = useActivity(active === "activity" ? workspaceId : undefined);
  const { data: audit } = useAgentAuditLog(active === "ai" ? workspaceId : undefined);

  const flow = useMemo(() => dailyFlow(tasks, now, 14), [tasks, now]);
  const load = useMemo(() => workload(tasks, now), [tasks, now]);


  return (
    <section aria-label="Аналитика" className="min-w-0 space-y-3 rounded-2xl border border-border bg-card/60 p-3">
      {section.locked ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-title text-foreground">
            <BarChart3 className="h-4 w-4 text-muted-foreground" /> Аналитика
          </h2>
          <SectionTabs<Mode> baseId="dashboard" tabs={modes} value={active} onChange={chooseMode} size="sm" />
        </div>
      )}
      {section.missing ? <p className="text-label text-subtle-foreground">Этой вкладки больше нет: её раздел выключен. Данные сохранены.</p> : null}

      {!section.missing && active === "personal" ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile value={load.open} label="открыто" onClick={() => showTasksFiltered({})} />
            <StatTile value={load.inProgress} label="в работе" onClick={() => showTasksFiltered({ statuses: ["in_progress"] })} />
            <StatTile value={load.overdue} label="просрочено" tone={load.overdue > 0 ? "danger" : undefined} onClick={() => showTasksFiltered({ due: "overdue" })} />
            <StatTile value={load.dueToday} label="на сегодня" onClick={() => showTasksFiltered({ due: "today" })} />
            <StatTile value={load.dueWeek} label="ближайшие 7 дней" onClick={() => showTasksFiltered({ due: "week" })} />
            <StatTile value={load.blocked} label="ждут зависимость" tone={load.blocked > 0 ? "warning" : undefined} onClick={() => showTasksFiltered({})} />
          </div>
          <FlowChart flow={flow} />
        </div>
      ) : null}

      {!section.missing && active === "projects" ? (
        (projects ?? []).length === 0 ? (
          <p className="text-label text-subtle-foreground">Проектов пока нет.</p>
        ) : (
          <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]">
            {(projects ?? []).map((project) => (
              <li key={project.id}>
                <button type="button" onClick={() => openProject(project.id, project.name)} className="w-full space-y-1 rounded-xl border border-border px-3 py-2 text-left hover:bg-white/5">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-label">{project.name}</span>
                    <span className="shrink-0 font-mono text-2xs tabular-nums text-subtle-foreground">
                      {project.counts.tasks === 0 ? "нет задач" : `${project.counts.closed}/${project.counts.tasks}`}
                    </span>
                  </span>
                  <Bar value={project.counts.tasks === 0 ? null : project.progress} />
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {!section.missing && active === "goals" ? (
        (goals ?? []).length === 0 ? (
          <p className="text-label text-subtle-foreground">Целей пока нет — они создаются в панели «Цели».</p>
        ) : (
          <div className="space-y-3">
          <FeaturedGoal goal={featuredGoal(goals ?? [])} />
          <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]">
            {(goals ?? []).map((goal) => (
              <li key={goal.id}>
                <button type="button" onClick={() => openPanel("goals")} className="w-full space-y-1 rounded-xl border border-border px-3 py-2 text-left hover:bg-white/5">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-label">{goal.title}</span>
                    <span className="shrink-0 font-mono text-2xs tabular-nums text-subtle-foreground">
                      {goal.progress === null ? "—" : `${goal.progress}%`} · планов {goal.plans.length}
                      {goal.subGoalCount > 0 ? ` · подцелей ${goal.subGoalCount}` : ""}
                    </span>
                  </span>
                  <Bar value={goal.progress} />
                </button>
              </li>
            ))}
          </ul>
          </div>
        )
      ) : null}

      {!section.missing && active === "activity" ? (
        (activity ?? []).length === 0 ? (
          <p className="text-label text-subtle-foreground">Пока нет событий.</p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-xl border border-border text-label">
            {(activity ?? []).map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5">
                <span className="shrink-0 font-mono text-2xs tabular-nums text-subtle-foreground">
                  {new Date(entry.at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className={cx("shrink-0", entry.actorKind === "agent" && "text-accent-text")}>
                  {entry.actorKind === "agent" ? `🤖 ${entry.actorName}` : entry.actorName}
                </span>
                <span className="min-w-0 flex-1 text-muted-foreground">{entry.summary}</span>
                {entry.entity ? (
                  <button type="button" onClick={() => openEntity(entry.entity!.type, entry.entity!.id, entry.entity!.title)} className="max-w-[16rem] truncate hover:underline">
                    {entry.entity.title}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}

      {!section.missing && active === "ai" ? (
        (audit ?? []).length === 0 ? (
          <p className="text-label text-subtle-foreground">
            Агенты пока ничего не делали. Токены выпускаются в Настройках → «ИИ-агенты».
          </p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2 sm:max-w-md">
              <StatTile value={audit?.length ?? 0} label="последних действий" onClick={() => openSettings("agents", "agents")} />
              <StatTile value={(audit ?? []).filter((e) => e.status >= 400).length} label="отказов и ошибок" tone={(audit ?? []).some((e) => e.status >= 400) ? "warning" : undefined} onClick={() => openSettings("agents", "agents")} />
              <StatTile value={new Set((audit ?? []).map((e) => e.tokenName)).size} label="агентов" onClick={() => openSettings("agents", "agents")} />
            </div>
          </div>
        )
      ) : null}
    </section>
  );
}

/**
 * One analytics mode as a panel of its own (`view:dashboard~<mode>`): the same component as inside the
 * dashboard, locked to the mode. Used by `DashboardPanel` when it receives locked params.
 */
export function DashboardAnalyticsView({ params, api, tasks, now, workspaceId, tasksOn }: {
  params: PanelComponentProps["params"];
  api: PanelComponentProps["api"];
  tasks: Task[];
  now: Date;
  workspaceId: string | undefined;
  tasksOn: boolean;
}): React.ReactElement {
  const modeLabel = sectionTabTitle(
    ([
      { value: "personal", label: "Личный" },
      { value: "projects", label: "Проекты" },
      { value: "goals", label: "Цели" },
      { value: "activity", label: "Журнал" },
      { value: "ai", label: "ИИ" }
    ] as SectionTab<string>[]).find((tab) => tab.value === params?.view)
  );
  return (
    <PanelShell>
      <PanelHeader icon={BarChart3} title="Аналитика" subtitle={modeLabel} />
      <PanelBody className="[container-type:inline-size]">
        {tasksOn ? (
          <DashboardAnalytics workspaceId={workspaceId} tasks={tasks} now={now} params={params} api={api} />
        ) : (
          <p className="text-label text-subtle-foreground">Модуль «Задачи» выключен в этом пространстве. Данные сохранены.</p>
        )}
      </PanelBody>
    </PanelShell>
  );
}

/**
 * The goal closest to done, large: the liquid gauge carries the mood, the printed percentage the
 * fact. A reached goal gets the travelling light for the moment it is shown — the event, not a
 * permanent decoration.
 */
function FeaturedGoal({ goal }: { goal: { id: string; title: string; progress: number | null; dueAt: string | null; plans: readonly unknown[] } | null }): React.ReactElement | null {
  if (!goal) return null;
  const reached = goal.progress === 100;
  return (
    <StarBorder active={reached} className="rounded-xl">
      <button
        type="button"
        onClick={() => openPanel("goals")}
        className="flex w-full items-center gap-4 rounded-xl border border-border px-4 py-3 text-left hover:bg-white/5"
      >
        <SloshGauge value={goal.progress} size={76} label={`Прогресс цели «${goal.title}»`} />
        <span className="min-w-0 space-y-0.5">
          <span className="block text-2xs uppercase tracking-wide text-subtle-foreground">{reached ? "Цель достигнута" : "Ближе всего к цели"}</span>
          <span className="block truncate text-sm font-medium text-foreground">{goal.title}</span>
          <span className="block text-2xs text-subtle-foreground">
            планов {goal.plans.length}
            {goal.dueAt ? ` · до ${shortDate(goal.dueAt)}` : ""}
          </span>
        </span>
      </button>
    </StarBorder>
  );
}
