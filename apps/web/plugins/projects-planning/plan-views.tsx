"use client";

import { useCreateMilestone, useMilestones, useTasks, useUpdateTask } from "@orion/core-react";
import { isTaskClosed, type Milestone, type Task } from "@orion/shared-types";
import {
  Button,
  Calendar,
  CheckToggle,
  EmptyState,
  Modal,
  SegmentedControl,
  Skeleton,
  cx,
  useResizeWidth,
  useToast,
  type CalendarItem
} from "@orion/ui";
import { Milestone as MilestoneIcon, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { shortDate } from "../../lib/extensions/host-api";
import { openEntity, openPanel } from "../../lib/extensions/host-api";
import { dayOffset, planDates, planGroups, timelineRange, weekTicks, type PlanGroup, type PlanRow } from "../../lib/extensions/host-api";
import { daysUntil, planStrip, pluralDays, type PlanStepState } from "../../lib/extensions/host-api";
import { useActiveWorkspace } from "../../lib/extensions/host-api";
import { ProjectGantt } from "./gantt";
import { MilestoneForm, type MilestoneFormValues } from "./milestone-form";
import { Meter } from "../../lib/extensions/host-api";

type PlanView = "timeline" | "roadmap" | "calendar" | "gantt";
const VIEW_KEY = "orion.project-plan-view";
const VIEW_OPTIONS: { value: PlanView; label: string }[] = [
  { value: "timeline", label: "Таймлайн" },
  { value: "roadmap", label: "Лента" },
  { value: "calendar", label: "Календарь" },
  { value: "gantt", label: "Гант" }
];

/**
 * The project plan as ONE set of data in several views (one question, several answers):
 *  - Таймлайн — milestones with their tasks on a weekly axis, deadlines as markers;
 *  - Лента — a vertical roadmap of stages with progress, readable on a phone;
 *  - Календарь — the month, only this project's tasks and milestones;
 *  - Гант — bars with duration and dragging, for work that has a start and an end.
 * Switching never copies anything: every view reads the same milestones and tasks.
 */
export function ProjectPlan({ projectId }: { projectId: string }): React.ReactElement {
  const [view, setView] = useState<PlanView>("timeline");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === "timeline" || saved === "roadmap" || saved === "calendar" || saved === "gantt") setView(saved);
    } catch {
      /* a remembered view is a convenience only */
    }
  }, []);
  function choose(next: PlanView): void {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* ignore */
    }
  }

  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const milestonesQuery = useMilestones(workspaceId, projectId);
  const tasksQuery = useTasks(workspaceId);
  const createMilestone = useCreateMilestone(workspaceId);
  const updateTask = useUpdateTask(workspaceId);
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);

  const milestones = useMemo(() => milestonesQuery.data ?? [], [milestonesQuery.data]);
  const tasks = useMemo(() => (tasksQuery.data ?? []).filter((task) => task.projectId === projectId), [tasksQuery.data, projectId]);
  const loading = milestonesQuery.isLoading || tasksQuery.isLoading;

  function toggle(task: Task): void {
    updateTask.mutate(
      { taskId: task.id, input: { status: task.status === "done" ? "todo" : "done" } },
      { onError: () => toast({ title: "Не удалось обновить задачу", tone: "danger" }) }
    );
  }

  async function createNow(values: MilestoneFormValues): Promise<void> {
    try {
      await createMilestone.mutateAsync({
        projectId,
        title: values.title,
        note: values.note,
        status: values.status,
        startAt: values.startAt,
        dueAt: values.dueAt,
        estimatedMinutes: values.estimatedMinutes,
        order: milestones.length,
        dependencyIds: values.dependencyIds
      });
      setCreating(false);
      toast({ title: "Веха создана", tone: "success" });
    } catch {
      toast({ title: "Не удалось создать веху", tone: "danger" });
    }
  }

  const openTask = (task: Task): void => {
    openEntity("task", task.id);
    openPanel("tasks");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl<PlanView> aria-label="Вид плана" size="sm" value={view} onChange={choose} options={VIEW_OPTIONS} />
        {/* The Gantt carries its own «Веха» button next to its scale controls. */}
        {view !== "gantt" ? (
          <Button size="sm" variant="subtle" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Веха
          </Button>
        ) : null}
      </div>

      {view === "gantt" ? (
        <ProjectGantt projectId={projectId} />
      ) : loading ? (
        <Skeleton className="h-48 w-full" />
      ) : milestones.length === 0 && tasks.length === 0 ? (
        <EmptyState
          icon={MilestoneIcon}
          title="Плана пока нет"
          description="Заведите веху — этап проекта — и поставьте задачам сроки: они появятся здесь."
          action={
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Веха
            </Button>
          }
        />
      ) : view === "timeline" ? (
        <TimelineView tasks={tasks} milestones={milestones} onOpen={openTask} />
      ) : view === "roadmap" ? (
        <RoadmapView tasks={tasks} milestones={milestones} onOpen={openTask} onToggle={toggle} />
      ) : (
        <CalendarView tasks={tasks} milestones={milestones} onOpen={openTask} />
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Новая веха" size="md">
        <MilestoneForm
          dependencyOptions={milestones}
          busy={createMilestone.isPending}
          submitLabel="Создать"
          onCancel={() => setCreating(false)}
          onSubmit={createNow}
        />
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Таймлайн
// ---------------------------------------------------------------------------

const PX_PER_DAY = 28;
const ROW_H = 34;
const LABEL_W = 208;

function markerTone(row: PlanRow, now: Date): string {
  if (isTaskClosed(row.task.status)) return "bg-success";
  if (row.due && row.due.getTime() < now.getTime()) return "bg-destructive";
  if (row.task.blocked) return "bg-warning";
  return "bg-foreground/70";
}

/**
 * Milestones with their tasks on a weekly axis. A deadline is a diamond on its day (not a
 * grey square the size of a button); a task with both a start and a due date is a bar.
 * Work without a date is listed at the foot of its group instead of being drawn somewhere
 * it is not. Read-only by design: moving dates is the Gantt's job.
 */
function TimelineView({
  tasks,
  milestones,
  onOpen
}: {
  tasks: Task[];
  milestones: Milestone[];
  onOpen: (task: Task) => void;
}): React.ReactElement {
  const now = new Date();
  const groups = useMemo(() => planGroups(tasks, milestones), [tasks, milestones]);
  const range = useMemo(() => timelineRange(planDates(groups), now), [groups]); // eslint-disable-line react-hooks/exhaustive-deps
  const ticks = weekTicks(range);
  const [frameRef, frameWidth] = useResizeWidth<HTMLDivElement>();
  // Fill the panel when the plan is short; scroll when it is long.
  const pxPerDay = Math.max(PX_PER_DAY, frameWidth > LABEL_W ? Math.floor((frameWidth - LABEL_W) / range.days) : 0);
  const chartWidth = range.days * pxPerDay;
  const todayX = (dayOffset(now, range.start) + 0.5) * pxPerDay;
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, todayX - el.clientWidth / 3);
    // Once, when the chart first has a width.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameWidth > 0]);

  const x = (date: Date): number => (dayOffset(date, range.start) + 0.5) * pxPerDay;

  return (
    <div ref={frameRef} className="overflow-hidden rounded-xl border border-border">
      <div className="flex">
        <div style={{ width: LABEL_W }} className="shrink-0 border-r border-border">
          <div className="h-7 border-b border-border" />
          {groups.map((group) => (
            <GroupLabels key={group.milestone?.id ?? "none"} group={group} onOpen={onOpen} />
          ))}
        </div>

        <div ref={scrollRef} className="orion-scroll min-w-0 flex-1 overflow-x-auto">
          <div style={{ width: chartWidth }} className="relative">
            <div className="relative h-7 border-b border-border">
              {ticks.map((tick) => (
                <span
                  key={tick.offset}
                  className="absolute top-0 h-full border-l border-white/5 pl-1 text-2xs leading-7 text-subtle-foreground"
                  style={{ left: tick.offset * pxPerDay }}
                >
                  {tick.label}
                </span>
              ))}
              <span
                className="absolute top-0 z-10 h-full -translate-x-1/2 rounded-b bg-accent px-1 text-2xs font-medium leading-7 text-accent-foreground"
                style={{ left: todayX }}
              >
                сегодня
              </span>
            </div>
            <div className="pointer-events-none absolute bottom-0 top-7 w-px bg-accent/70" style={{ left: todayX }} aria-hidden />
            {ticks.map((tick) => (
              <div key={tick.offset} className="pointer-events-none absolute bottom-0 top-7 w-px bg-white/[0.04]" style={{ left: tick.offset * pxPerDay }} aria-hidden />
            ))}

            {groups.map((group) => (
              <div key={group.milestone?.id ?? "none"}>
                <div style={{ height: ROW_H }} className="relative border-b border-white/5 bg-white/[0.02]">
                  {group.milestone ? <MilestoneMark milestone={group.milestone} x={x} pxPerDay={pxPerDay} /> : null}
                </div>
                {group.dated.map((row) => (
                  <div key={row.task.id} style={{ height: ROW_H }} className="relative border-b border-white/5">
                    <TaskMark row={row} x={x} now={now} onOpen={onOpen} />
                  </div>
                ))}
                {group.undated.length > 0 ? <div style={{ height: ROW_H }} className="border-b border-white/5" /> : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupLabels({ group, onOpen }: { group: PlanGroup; onOpen: (task: Task) => void }): React.ReactElement {
  return (
    <div>
      <div style={{ height: ROW_H }} className="flex items-center gap-2 border-b border-white/5 bg-white/[0.02] px-2">
        <span className="min-w-0 flex-1 truncate text-label font-medium text-foreground" title={group.milestone?.title ?? "Без вехи"}>
          {group.milestone?.title ?? "Без вехи"}
        </span>
        <span className="shrink-0 font-mono text-micro tabular-nums text-subtle-foreground">
          {group.closed}/{group.open + group.closed}
        </span>
      </div>
      {group.dated.map((row) => (
        <div key={row.task.id} style={{ height: ROW_H }} className="flex items-center border-b border-white/5 pl-4 pr-2">
          <button
            type="button"
            onClick={() => onOpen(row.task)}
            title={row.task.title}
            className={cx(
              "min-w-0 flex-1 truncate text-left text-label hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
              isTaskClosed(row.task.status) ? "text-subtle-foreground line-through" : "text-muted-foreground"
            )}
          >
            {row.task.title}
          </button>
        </div>
      ))}
      {group.undated.length > 0 ? (
        <div style={{ height: ROW_H }} className="flex items-center border-b border-white/5 pl-4 pr-2 text-micro text-subtle-foreground">
          <span className="truncate" title={group.undated.map((t) => t.title).join(", ")}>
            Без даты: {group.undated.length}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function MilestoneMark({ milestone, x, pxPerDay }: { milestone: Milestone; x: (d: Date) => number; pxPerDay: number }): React.ReactElement | null {
  const due = milestone.dueAt ? new Date(milestone.dueAt) : null;
  const start = milestone.startAt ? new Date(milestone.startAt) : null;
  if (!due && !start) return null;
  const end = due ?? start!;
  const from = start ? x(start) : x(end);
  const to = x(end);
  const done = milestone.status === "done";
  return (
    <>
      {start && due && to > from ? (
        <span className={cx("absolute top-1/2 h-2 -translate-y-1/2 rounded-full", done ? "bg-success/30" : "bg-accent/30")} style={{ left: from, width: to - from }} aria-hidden />
      ) : null}
      <span
        className={cx("absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px]", done ? "bg-success" : "bg-accent")}
        style={{ left: to }}
        title={`${milestone.title} · до ${shortDate(end.toISOString())}`}
        role="img"
        aria-label={`Веха «${milestone.title}», срок ${shortDate(end.toISOString())}`}
      />
      <span className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-3 text-2xs text-muted-foreground" style={{ left: to + Math.min(pxPerDay, 12) }}>
        {milestone.title}
      </span>
    </>
  );
}

function TaskMark({ row, x, now, onOpen }: { row: PlanRow; x: (d: Date) => number; now: Date; onOpen: (task: Task) => void }): React.ReactElement {
  const end = row.due ?? row.start!;
  const start = row.start && row.due && row.start.getTime() < row.due.getTime() ? row.start : null;
  const to = x(end);
  const tone = markerTone(row, now);
  const when = shortDate(end.toISOString());
  return (
    <>
      {start ? <span className={cx("absolute top-1/2 h-2 -translate-y-1/2 rounded-full opacity-40", tone)} style={{ left: x(start), width: Math.max(4, to - x(start)) }} aria-hidden /> : null}
      <button
        type="button"
        onClick={() => onOpen(row.task)}
        title={`${row.task.title} · ${row.due ? "срок" : "начало"} ${when}`}
        aria-label={`${row.task.title}, ${row.due ? "срок" : "начало"} ${when}`}
        className="absolute top-1/2 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        style={{ left: to }}
      >
        <span className={cx("h-2.5 w-2.5 rotate-45 rounded-[2px]", tone)} />
      </button>
      <span className="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-3 text-2xs text-subtle-foreground" style={{ left: to + 8 }}>
        {when}
      </span>
    </>
  );
}

// ---------------------------------------------------------------------------
// Лента
// ---------------------------------------------------------------------------

const STATE_LABEL: Record<PlanStepState, string> = { done: "Готово", current: "Сейчас", upcoming: "Впереди", overdue: "Просрочено" };
const STATE_TONE: Record<PlanStepState, string> = {
  done: "border-success/40 text-success",
  current: "border-accent/50 text-accent-text",
  upcoming: "border-border text-muted-foreground",
  overdue: "border-destructive/50 text-destructive"
};
const STATE_DOT: Record<PlanStepState, string> = { done: "bg-success", current: "bg-accent", upcoming: "bg-white/20", overdue: "bg-destructive" };

/** A vertical roadmap: stages top to bottom with state, dates, progress and their tasks. */
function RoadmapView({
  tasks,
  milestones,
  onOpen,
  onToggle
}: {
  tasks: Task[];
  milestones: Milestone[];
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
}): React.ReactElement {
  const steps = planStrip(milestones, tasks);
  const groups = planGroups(tasks, milestones);
  const byId = new Map(groups.filter((g) => g.milestone).map((g) => [g.milestone!.id, g]));
  const loose = groups.find((g) => !g.milestone);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(steps.filter((s) => s.state === "current" || s.state === "overdue").map((s) => s.milestone.id)));

  const toggleOpen = (id: string): void =>
    setOpenIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ol className="relative space-y-3 border-l border-border pl-5">
      {steps.map((step) => {
        const group = byId.get(step.milestone.id);
        const percent = step.total === 0 ? 0 : Math.round((step.closed / step.total) * 100);
        const due = step.milestone.dueAt;
        const days = due ? daysUntil(due) : null;
        const open = openIds.has(step.milestone.id);
        return (
          <li key={step.milestone.id} className="relative" aria-current={step.state === "current" ? "step" : undefined}>
            <span className={cx("absolute -left-[1.6rem] top-4 h-2.5 w-2.5 rounded-full ring-4 ring-panel", STATE_DOT[step.state])} aria-hidden />
            <div className="rounded-xl border border-border bg-card">
              <button
                type="button"
                onClick={() => toggleOpen(step.milestone.id)}
                aria-expanded={open}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">{step.milestone.title}</span>
                <span className={cx("rounded-full border px-2 py-0.5 text-micro", STATE_TONE[step.state])}>{STATE_LABEL[step.state]}</span>
                <span className="text-micro text-subtle-foreground">
                  {due ? `до ${shortDate(due)}` : "без срока"}
                  {days !== null && step.state !== "done" ? ` · ${days < 0 ? `просрочено на ${pluralDays(-days)}` : days === 0 ? "сегодня" : `через ${pluralDays(days)}`}` : ""}
                </span>
                <span className="basis-full">
                  <span className="flex items-center gap-2">
                    <span className="w-full max-w-[14rem]">
                      <Meter value={percent} tone={step.state === "done" ? "success" : step.state === "overdue" ? "danger" : "accent"} />
                    </span>
                    <span className="font-mono text-micro tabular-nums text-subtle-foreground">{step.total === 0 ? "задач нет" : `${step.closed}/${step.total}`}</span>
                  </span>
                </span>
              </button>
              {open && group ? <RoadmapTasks group={group} onOpen={onOpen} onToggle={onToggle} /> : null}
            </div>
          </li>
        );
      })}
      {loose && loose.dated.length + loose.undated.length > 0 ? (
        <li className="relative">
          <span className="absolute -left-[1.6rem] top-4 h-2.5 w-2.5 rounded-full bg-white/20 ring-4 ring-panel" aria-hidden />
          <div className="rounded-xl border border-dashed border-border">
            <button
              type="button"
              onClick={() => toggleOpen("__loose__")}
              aria-expanded={openIds.has("__loose__")}
              className="flex w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <span className="flex-1 text-body text-muted-foreground">Без вехи</span>
              <span className="font-mono text-micro tabular-nums text-subtle-foreground">
                {loose.closed}/{loose.open + loose.closed}
              </span>
            </button>
            {openIds.has("__loose__") ? <RoadmapTasks group={loose} onOpen={onOpen} onToggle={onToggle} /> : null}
          </div>
        </li>
      ) : null}
    </ol>
  );
}

function RoadmapTasks({ group, onOpen, onToggle }: { group: PlanGroup; onOpen: (task: Task) => void; onToggle: (task: Task) => void }): React.ReactElement {
  const all = [...group.dated.map((row) => row.task), ...group.undated];
  if (all.length === 0) return <p className="border-t border-border px-4 py-3 text-label text-subtle-foreground">Задач у этапа пока нет.</p>;
  return (
    <ul className="border-t border-border px-2 py-1">
      {all.map((task) => {
        const closed = isTaskClosed(task.status);
        const overdue = !closed && task.dueAt !== null && Date.parse(task.dueAt) < Date.now();
        return (
          <li key={task.id} className="flex items-center gap-2 rounded-lg px-2 py-row hover:bg-card-hover">
            <CheckToggle
              checked={task.status === "done"}
              onClick={() => onToggle(task)}
              label={task.status === "done" ? "Вернуть в работу" : "Отметить выполненной"}
              disabled={task.status === "canceled"}
              size="sm"
            />
            <button
              type="button"
              onClick={() => onOpen(task)}
              className={cx("min-w-0 flex-1 truncate text-left text-label focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60", closed ? "text-subtle-foreground line-through" : "text-foreground hover:underline")}
            >
              {task.title}
            </button>
            {task.dueAt ? (
              <span className={cx("shrink-0 font-mono text-micro tabular-nums", overdue ? "text-destructive" : "text-subtle-foreground")}>{shortDate(task.dueAt)}</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Календарь
// ---------------------------------------------------------------------------

/** The month grid of the shared Calendar, fed only with this project's tasks and milestones. Read-only: dates move in the task or the Gantt. */
function CalendarView({ tasks, milestones, onOpen }: { tasks: Task[]; milestones: Milestone[]; onOpen: (task: Task) => void }): React.ReactElement {
  const items = useMemo<CalendarItem[]>(() => {
    const out: CalendarItem[] = [];
    for (const task of tasks) {
      if (!task.dueAt) continue;
      const closed = isTaskClosed(task.status);
      out.push({
        id: task.id,
        start: task.dueAt,
        label: task.title,
        kind: "task",
        tone: "task",
        done: closed,
        overdue: !closed && Date.parse(task.dueAt) < Date.now(),
        readOnly: true
      });
    }
    for (const milestone of milestones) {
      if (!milestone.dueAt) continue;
      out.push({
        id: `milestone:${milestone.id}`,
        start: milestone.dueAt,
        label: `⚑ ${milestone.title}`,
        kind: "event",
        tone: "milestone",
        allDay: true,
        done: milestone.status === "done",
        readOnly: true
      });
    }
    return out;
  }, [tasks, milestones]);

  return (
    <Calendar
      items={items}
      onItemClick={(id) => {
        const task = tasks.find((t) => t.id === id);
        if (task) onOpen(task);
      }}
    />
  );
}
