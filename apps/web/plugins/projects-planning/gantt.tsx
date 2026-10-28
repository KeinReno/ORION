"use client";

import {
  useCreateMilestone,
  useDeleteMilestone,
  useMilestoneReschedulePreview,
  useMilestones,
  useTasks,
  useUpdateMilestone,
  useUpdateTask
} from "@orion/core-react";
import { formatDuration, isTaskClosed, type Milestone, type MilestoneCascadeImpact, type Task } from "@orion/shared-types";
import { Button, ConfirmDialog, DropdownMenu, EmptyState, IconButton, Modal, SegmentedControl, Skeleton, cx, useContextMenuApi, useResizeWidth, useToast, type MenuItem } from "@orion/ui";
import { Milestone as MilestoneIcon, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { openProjectTask } from "../../lib/extensions/host-api";
import { shortDateTime } from "../../lib/extensions/host-api";
import { useActiveWorkspace } from "../../lib/extensions/host-api";
import { criticalPath } from "./gantt-critical-path";
import { MilestoneForm, type MilestoneFormValues } from "./milestone-form";
import { TODAY_HALF_W, coveredByToday } from "./today-badge";

/**
 * Project Gantt (v0.27) — the plan tab of a project's detail Sheet. Two
 * levels of row: milestones (their own bars, `Milestone.startAt/dueAt`) and
 * the tasks grouped under each via `Task.milestoneId`, plus an "Без вехи"
 * group for the project's own dated tasks that aren't on a milestone.
 *
 * Deliberately shows only *dated* items — a task with neither `startAt` nor
 * `dueAt` has nothing to draw a bar from, and the Gantt is a planning view,
 * not the task list (that's the Tasks panel/board). Drag-move and
 * drag-resize mirror the calendar's `time-grid.tsx` (pointer events, window-
 * level move/up listeners, commit on release) — horizontal instead of
 * vertical, days instead of minutes.
 */

/**
 * Horizontal scale: pixels per day. The chart used to be fixed at 32, which is
 * unreadable for a month-long trip squeezed into a corner and for a year-long
 * plan alike. Remembered per browser.
 */
type GanttScale = "close" | "normal" | "far";
const SCALE_PX: Record<GanttScale, number> = { close: 56, normal: 32, far: 14 };
const SCALE_LABEL: Record<GanttScale, string> = { close: "Дни", normal: "Недели", far: "Месяцы" };
const SCALE_KEY = "orion.gantt.scale";
const CRITICAL_KEY = "orion.gantt.critical";

function loadScale(): GanttScale {
  try {
    const saved = localStorage.getItem(SCALE_KEY);
    return saved === "close" || saved === "far" ? saved : "normal";
  } catch {
    return "normal";
  }
}

function loadShowCritical(): boolean {
  try {
    return localStorage.getItem(CRITICAL_KEY) === "1";
  } catch {
    return false;
  }
}
const ROW_H = 32;
const LABEL_W = 220;
/** Wide enough for both resize handles without collapsing into a one-glyph chip. */
const MIN_BAR_PX = 28;
/** Inner title is unreadable below this — the label column already has the name. */
const BAR_LABEL_MIN_PX = 72;
const DAY_MS = 86_400_000;
const EDGE_PX = 7;

type NodeKind = "milestone" | "task" | "header";

interface GanttNode {
  kind: NodeKind;
  id: string;
  title: string;
  startAt: Date | null;
  dueAt: Date | null;
  dependencyIds: string[];
  blocked: boolean;
  done: boolean;
  estimatedMinutes: number | null;
}

interface DragState {
  kind: "move" | "resize-start" | "resize-end";
  node: GanttNode;
  /** clientX at pointerdown — everything else is a delta from here, so a uniform day-width grid needs no DOM measurement to track. */
  anchorX: number;
  deltaDays: number;
}

export function ProjectGantt({ projectId }: { projectId: string }): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const milestonesQuery = useMilestones(workspaceId, projectId);
  const tasksQuery = useTasks(workspaceId);
  const createMilestone = useCreateMilestone(workspaceId);
  const updateMilestone = useUpdateMilestone(workspaceId);
  const reschedulePreview = useMilestoneReschedulePreview(workspaceId);
  const deleteMilestone = useDeleteMilestone(workspaceId);
  const updateTask = useUpdateTask(workspaceId);
  const { toast } = useToast();

  const [creatingMilestone, setCreatingMilestone] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null);
  const [pendingDeleteMilestone, setPendingDeleteMilestone] = useState<Milestone | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [scale, setScale] = useState<GanttScale>("normal");
  const [showCritical, setShowCritical] = useState(false);
  // Read after mount so the first paint matches the server-rendered markup.
  useEffect(() => {
    setScale(loadScale());
    setShowCritical(loadShowCritical());
  }, []);
  const pxPerDay = SCALE_PX[scale];
  const scrollRef = useRef<HTMLDivElement>(null);
  function chooseScale(next: GanttScale): void {
    setScale(next);
    try {
      localStorage.setItem(SCALE_KEY, next);
    } catch {
      /* the remembered scale is a convenience only */
    }
  }
  function toggleCritical(): void {
    const next = !showCritical;
    setShowCritical(next);
    try {
      localStorage.setItem(CRITICAL_KEY, next ? "1" : "0");
    } catch {
      /* the remembered toggle is a convenience only */
    }
  }
  // S14a — cascade preview. A date edit on a milestone with dependents is
  // held here instead of applied immediately: `applyMilestoneDates` always
  // asks the read-only preview endpoint first, and only routes through this
  // state (a confirm step naming every affected milestone) when the answer
  // is non-empty. No dependents move → nothing to confirm → applies right
  // away, so the common case stays a plain drag-and-drop.
  const [pendingCascade, setPendingCascade] = useState<{
    milestoneId: string;
    startAt: string | null;
    dueAt: string | null;
    impacts: MilestoneCascadeImpact[];
    onApplied?: () => void;
  } | null>(null);

  const milestones = useMemo(() => milestonesQuery.data ?? [], [milestonesQuery.data]);
  const tasks = useMemo(() => (tasksQuery.data ?? []).filter((task) => task.projectId === projectId), [tasksQuery.data, projectId]);

  const rows = useMemo(() => buildRows(milestones, tasks), [milestones, tasks]);
  const critical = useMemo(() => criticalPath(rows), [rows]);
  // The time axis is at least as wide as the panel, so the plan fills the space instead of
  // ending in the middle of an empty frame; a longer plan simply scrolls.
  const [frameRef, frameWidth] = useResizeWidth<HTMLDivElement>();
  // Leave a useful time axis in a narrow Dockview panel or phone viewport.
  // The desktop label width remains unchanged.
  const labelWidth = frameWidth > 0 ? Math.min(LABEL_W, Math.max(112, Math.round(frameWidth * 0.45))) : LABEL_W;
  const baseRange = useMemo(() => computeRange(rows), [rows]);
  const range = useMemo(() => {
    const fillDays = frameWidth > labelWidth ? Math.ceil((frameWidth - labelWidth) / pxPerDay) : 0;
    return fillDays > baseRange.totalDays ? { ...baseRange, totalDays: fillDays } : baseRange;
  }, [baseRange, frameWidth, labelWidth, pxPerDay]);

  function scrollToToday(behavior: ScrollBehavior): void {
    const el = scrollRef.current;
    if (!el) return;
    const offset = ((Date.now() - range.start.getTime()) / DAY_MS) * pxPerDay;
    el.scrollTo({ left: Math.max(0, offset - el.clientWidth / 3), behavior });
  }
  // First time the chart has rows: bring today into view (a plan far in the past or future would otherwise open on its left edge).
  const scrolledOnce = useRef(false);
  useEffect(() => {
    if (scrolledOnce.current || rows.length === 0) return;
    scrolledOnce.current = true;
    const id = window.setTimeout(() => scrollToToday("auto"), 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  // Mirrors the calendar's `time-grid.tsx`: a local drag state, window-level
  // move/up listeners while dragging, commit on release. Horizontal + days
  // instead of vertical + minutes, and a uniform `PX_PER_DAY` grid means the
  // delta is just `(clientX - anchorX) / PX_PER_DAY` — no DOM measurement
  // needed to track it, unlike the calendar's per-column width.
  useEffect(() => {
    if (!drag) return;
    function onMove(e: PointerEvent): void {
      setDrag((prev) => (prev ? { ...prev, deltaDays: Math.round((e.clientX - prev.anchorX) / pxPerDay) } : prev));
    }
    function onUp(): void {
      setDrag((prev) => {
        if (prev) void commitDrag(prev);
        return null;
      });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(drag), pxPerDay]);

  async function commitDrag(state: DragState): Promise<void> {
    const { node, deltaDays } = state;
    if (deltaDays === 0) return;
    const shift = (date: Date | null): Date | null => (date ? new Date(date.getTime() + deltaDays * DAY_MS) : null);
    let nextStart: Date | null;
    let nextDue: Date | null;
    if (state.kind === "move") {
      nextStart = shift(node.startAt);
      nextDue = shift(node.dueAt);
    } else if (state.kind === "resize-start") {
      nextStart = shift(node.startAt ?? node.dueAt);
      nextDue = node.dueAt;
      if (nextStart && nextDue && nextStart >= nextDue) nextStart = new Date(nextDue.getTime() - DAY_MS);
    } else {
      nextStart = node.startAt;
      nextDue = shift(node.dueAt ?? node.startAt);
      if (nextStart && nextDue && nextDue <= nextStart) nextDue = new Date(nextStart.getTime() + DAY_MS);
    }

    const startAt = nextStart?.toISOString() ?? null;
    const dueAt = nextDue?.toISOString() ?? null;
    if (node.kind === "milestone") {
      await applyMilestoneDates(node.id, startAt, dueAt);
    } else {
      try {
        await updateTask.mutateAsync({ taskId: node.id, input: { startAt, dueAt } });
        warnIfDependentsNowOverlap(node.id, nextDue ?? nextStart);
      } catch {
        toast({ title: "Не удалось перенести срок", tone: "danger" });
      }
    }
  }

  /**
   * ORION-05: tasks deliberately don't auto-cascade like milestones do (see
   * `MilestonesService`'s own comment — "the piece tasks don't need"), so a drag never silently
   * shifts another task. But silence about the side effect isn't the same as no side effect: if
   * the task just moved finishes LATER than another task's own start (one that names it as a
   * dependency), that other task now starts before its prerequisite is done. This says so —
   * read-only, informational, never auto-moves anything.
   */
  function warnIfDependentsNowOverlap(movedTaskId: string, newFinish: Date | null): void {
    if (!newFinish) return;
    const affected = tasks.filter((t) => {
      if (!t.dependencyIds.includes(movedTaskId)) return false;
      const theirStart = t.startAt ? new Date(t.startAt) : t.dueAt ? new Date(t.dueAt) : null;
      return theirStart !== null && theirStart.getTime() < newFinish.getTime();
    });
    if (affected.length === 0) return;
    toast({
      title: "Задача теперь начинается раньше предшественника",
      description: `Зависит от перенесённой: ${affected.map((t) => t.title).join(", ")}. Даты не изменены автоматически — перенесите вручную, если нужно.`
    });
  }

  /**
   * S14a — always previews before writing. `reschedulePreview` failing
   * (e.g. transient network error) doesn't block the edit itself: it falls
   * through and applies directly, exactly the behaviour that existed before
   * this feature — a broken preview must never be able to trap the user's
   * edit, only skip showing them a confirmation they'd have wanted.
   */
  async function applyMilestoneDates(milestoneId: string, startAt: string | null, dueAt: string | null, onApplied?: () => void): Promise<void> {
    let impacts: MilestoneCascadeImpact[] = [];
    try {
      impacts = await reschedulePreview.mutateAsync({ milestoneId, input: { startAt, dueAt } });
    } catch {
      impacts = [];
    }
    if (impacts.length > 0) {
      setPendingCascade({ milestoneId, startAt, dueAt, impacts, onApplied });
      return;
    }
    await commitMilestoneDates(milestoneId, startAt, dueAt, onApplied);
  }

  async function commitMilestoneDates(milestoneId: string, startAt: string | null, dueAt: string | null, onApplied?: () => void): Promise<void> {
    try {
      await updateMilestone.mutateAsync({ milestoneId, input: { startAt, dueAt } });
      onApplied?.();
    } catch {
      toast({ title: "Не удалось перенести срок", tone: "danger" });
    }
  }

  /**
   * `onApplied` here doubles as "how to actually write this": drag passes
   * none (plain dates-only commit is correct), the edit form passes its own
   * full-field commit closure (dates-only would drop title/status/etc
   * edited in the same save) — never call both.
   */
  function confirmCascade(): void {
    const pending = pendingCascade;
    if (!pending) return;
    setPendingCascade(null);
    if (pending.onApplied) {
      pending.onApplied();
    } else {
      void commitMilestoneDates(pending.milestoneId, pending.startAt, pending.dueAt);
    }
  }

  async function createMilestoneNow(values: MilestoneFormValues): Promise<void> {
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
      setCreatingMilestone(false);
      toast({ title: "Веха создана", tone: "success" });
    } catch {
      toast({ title: "Не удалось создать веху", tone: "danger" });
    }
  }

  async function saveMilestone(milestoneId: string, values: MilestoneFormValues): Promise<void> {
    const current = milestones.find((m) => m.id === milestoneId);
    const datesChanged = current ? current.startAt !== values.startAt || current.dueAt !== values.dueAt : true;
    if (!datesChanged) {
      // No date edit here — nothing for the cascade to react to, so skip the
      // preview round-trip and go straight through the plain update path.
      try {
        await updateMilestone.mutateAsync({ milestoneId, input: values });
        setEditingMilestone(null);
        toast({ title: "Сохранено", tone: "success" });
      } catch {
        toast({ title: "Не удалось сохранить веху", tone: "danger" });
      }
      return;
    }
    let impacts: MilestoneCascadeImpact[] = [];
    try {
      impacts = await reschedulePreview.mutateAsync({ milestoneId, input: { startAt: values.startAt, dueAt: values.dueAt } });
    } catch {
      impacts = [];
    }
    const commit = async (): Promise<void> => {
      try {
        await updateMilestone.mutateAsync({ milestoneId, input: values });
        setEditingMilestone(null);
        toast({ title: "Сохранено", tone: "success" });
      } catch {
        toast({ title: "Не удалось сохранить веху", tone: "danger" });
      }
    };
    if (impacts.length > 0) {
      setPendingCascade({ milestoneId, startAt: values.startAt, dueAt: values.dueAt, impacts, onApplied: () => void commit() });
      return;
    }
    await commit();
  }

  function confirmDeleteMilestone(): void {
    const milestone = pendingDeleteMilestone;
    if (!milestone) return;
    setPendingDeleteMilestone(null);
    deleteMilestone.mutate(milestone.id, {
      onSuccess: () => toast({ title: "Веха удалена", description: "Задачи под ней сохранены, просто без вехи", tone: "default" }),
      onError: () => toast({ title: "Не удалось удалить веху", tone: "danger" })
    });
  }

  const loading = milestonesQuery.isLoading || tasksQuery.isLoading;

  return (
    <section className="space-y-2 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium text-foreground">План</h4>
        <div className="flex flex-wrap items-center gap-2">
          {rows.length > 0 ? (
            <>
              <SegmentedControl<GanttScale>
                aria-label="Масштаб плана"
                size="sm"
                value={scale}
                onChange={chooseScale}
                options={(Object.keys(SCALE_PX) as GanttScale[]).map((value) => ({ value, label: SCALE_LABEL[value] }))}
              />
              <Button size="sm" variant="outline" onClick={() => scrollToToday("smooth")}>
                К сегодня
              </Button>
              <Button
                size="sm"
                variant={showCritical ? "primary" : "outline"}
                onClick={toggleCritical}
                title="Цепочка зависимостей, которая определяет дату завершения плана — сдвиг любого звена сдвигает и конец"
              >
                Критический путь
              </Button>
            </>
          ) : null}
          {/* An empty chart offers «Веха» in its empty state — one button, not two. */}
          {!loading && rows.length > 0 ? (
            <Button size="sm" variant="outline" onClick={() => setCreatingMilestone(true)}>
              <Plus className="h-4 w-4" /> Веха
            </Button>
          ) : null}
        </div>
      </div>

      {/* Always mounted: the width measurement attaches once, before the chart itself exists. */}
      <div ref={frameRef}>
      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={MilestoneIcon}
          title="Плана пока нет"
          description="Заведите веху или поставьте задаче срок и начало — она появится на диаграмме."
          action={
            <Button size="sm" onClick={() => setCreatingMilestone(true)}>
              <Plus className="h-4 w-4" /> Веха
            </Button>
          }
        />
      ) : (
        <GanttChart
          rows={rows}
          range={range}
          labelWidth={labelWidth}
          pxPerDay={pxPerDay}
          scrollRef={scrollRef}
          drag={drag}
          onStartDrag={(kind, node, clientX) => setDrag({ kind, node, anchorX: clientX, deltaDays: 0 })}
          onEditMilestone={(id) => setEditingMilestone(milestones.find((m) => m.id === id) ?? null)}
          onDeleteMilestone={(id) => setPendingDeleteMilestone(milestones.find((m) => m.id === id) ?? null)}
          onOpenTask={(id) => openProjectTask(projectId, id)}
          critical={showCritical ? critical : null}
        />
      )}
      </div>

      <Modal open={creatingMilestone} onClose={() => setCreatingMilestone(false)} title="Новая веха" size="md">
        <MilestoneForm
          dependencyOptions={milestones}
          busy={createMilestone.isPending}
          submitLabel="Создать"
          onCancel={() => setCreatingMilestone(false)}
          onSubmit={createMilestoneNow}
        />
      </Modal>

      <Modal open={editingMilestone !== null} onClose={() => setEditingMilestone(null)} title="Веха" size="md">
        {editingMilestone ? (
          <MilestoneForm
            key={editingMilestone.id}
            initial={editingMilestone}
            dependencyOptions={milestones.filter((m) => m.id !== editingMilestone.id)}
            busy={updateMilestone.isPending}
            submitLabel="Сохранить"
            onCancel={() => setEditingMilestone(null)}
            onSubmit={(values) => saveMilestone(editingMilestone.id, values)}
          />
        ) : null}
      </Modal>

      <ConfirmDialog
        open={pendingDeleteMilestone !== null}
        title="Удалить веху?"
        description={pendingDeleteMilestone ? `«${pendingDeleteMilestone.title}» будет удалена. Задачи под ней сохранятся, просто потеряют привязку к вехе.` : undefined}
        onConfirm={confirmDeleteMilestone}
        onCancel={() => setPendingDeleteMilestone(null)}
      />

      {/* S14a — cascade preview. Shown only when the reschedule-preview endpoint reports other milestones would also move (finish-to-start dependents); a no-op cascade never opens this. */}
      <ConfirmDialog
        open={pendingCascade !== null}
        title="Сдвинутся другие вехи"
        danger={false}
        confirmLabel="Применить"
        description={
          pendingCascade ? (
            <ul className="space-y-1">
              {pendingCascade.impacts.map((impact) => (
                <li key={impact.milestoneId}>
                  «{impact.title}»: {impact.previousStartAt ? shortDateTime(impact.previousStartAt) : "—"} → {impact.nextStartAt ? shortDateTime(impact.nextStartAt) : "—"}
                </li>
              ))}
            </ul>
          ) : undefined
        }
        onConfirm={confirmCascade}
        onCancel={() => setPendingCascade(null)}
      />
    </section>
  );
}

/**
 * Flattens milestones + their tasks (grouped by `Task.milestoneId`) into one
 * ordered row list, plus a trailing "Без вехи" group for this project's own
 * dated tasks that aren't grouped. A task with neither `startAt` nor `dueAt`
 * is skipped — it has nothing to draw a bar from (see the file comment). A
 * milestone is never skipped even without dates: it's a phase the user
 * deliberately created, and hiding it would also hide the tasks grouped
 * under it.
 */
function buildRows(milestones: Milestone[], tasks: Task[]): GanttNode[] {
  const byMilestone = new Map<string, Task[]>();
  const ungrouped: Task[] = [];
  for (const task of tasks) {
    if (!task.startAt && !task.dueAt) continue;
    if (task.milestoneId) {
      const list = byMilestone.get(task.milestoneId) ?? [];
      list.push(task);
      byMilestone.set(task.milestoneId, list);
    } else {
      ungrouped.push(task);
    }
  }
  const byDueAt = (a: Task, b: Task): number => (a.dueAt ?? a.startAt ?? "").localeCompare(b.dueAt ?? b.startAt ?? "");

  const rows: GanttNode[] = [];
  for (const milestone of [...milestones].sort((a, b) => a.order - b.order)) {
    rows.push(milestoneNode(milestone));
    for (const task of (byMilestone.get(milestone.id) ?? []).sort(byDueAt)) rows.push(taskNode(task));
  }
  if (ungrouped.length > 0) {
    rows.push({ kind: "header", id: "ungrouped", title: "Без вехи", startAt: null, dueAt: null, dependencyIds: [], blocked: false, done: false, estimatedMinutes: null });
    for (const task of ungrouped.sort(byDueAt)) rows.push(taskNode(task));
  }
  return rows;
}

function milestoneNode(milestone: Milestone): GanttNode {
  return {
    kind: "milestone",
    id: milestone.id,
    title: milestone.title,
    startAt: milestone.startAt ? new Date(milestone.startAt) : null,
    dueAt: milestone.dueAt ? new Date(milestone.dueAt) : null,
    dependencyIds: milestone.dependencyIds,
    blocked: milestone.blocked,
    done: milestone.status === "done",
    estimatedMinutes: milestone.estimatedMinutes
  };
}

function taskNode(task: Task): GanttNode {
  return {
    kind: "task",
    id: task.id,
    title: task.title,
    startAt: task.startAt ? new Date(task.startAt) : null,
    dueAt: task.dueAt ? new Date(task.dueAt) : null,
    dependencyIds: task.dependencyIds,
    blocked: task.blocked,
    done: isTaskClosed(task.status),
    estimatedMinutes: task.estimatedMinutes
  };
}

/** Date window the chart draws, padded 2 days each side with a 10-day floor so a one-item plan isn't a single sliver. */
function computeRange(rows: GanttNode[]): { start: Date; totalDays: number } {
  const dated = rows.filter((row) => row.startAt || row.dueAt);
  if (dated.length === 0) {
    return { start: new Date(), totalDays: 14 };
  }
  let min = Infinity;
  let max = -Infinity;
  for (const row of dated) {
    const start = (row.startAt ?? row.dueAt as Date).getTime();
    const end = (row.dueAt ?? row.startAt as Date).getTime();
    if (start < min) min = start;
    if (end > max) max = end;
  }
  const start = new Date(min - 2 * DAY_MS);
  const end = new Date(Math.max(max + 2 * DAY_MS, start.getTime() + 10 * DAY_MS));
  return { start, totalDays: Math.ceil((end.getTime() - start.getTime()) / DAY_MS) };
}

/** The node with `drag`'s pending delta applied, if `drag` targets it — what every bar actually renders from, so the drag preview needs no separate code path. */
function previewNode(node: GanttNode, drag: DragState | null): GanttNode {
  if (!drag || drag.node.kind !== node.kind || drag.node.id !== node.id || drag.deltaDays === 0) return node;
  const shift = (d: Date | null): Date | null => (d ? new Date(d.getTime() + drag.deltaDays * DAY_MS) : null);
  if (drag.kind === "move") return { ...node, startAt: shift(node.startAt), dueAt: shift(node.dueAt) };
  if (drag.kind === "resize-start") return { ...node, startAt: shift(node.startAt ?? node.dueAt) };
  return { ...node, dueAt: shift(node.dueAt ?? node.startAt) };
}

function barGeometry(node: GanttNode, range: { start: Date }, pxPerDay: number): { left: number; width: number } | null {
  const start = node.startAt ?? node.dueAt;
  const end = node.dueAt ?? node.startAt;
  if (!start || !end) return null;
  const left = ((start.getTime() - range.start.getTime()) / DAY_MS) * pxPerDay;
  const width = Math.max(MIN_BAR_PX, ((end.getTime() - start.getTime()) / DAY_MS) * pxPerDay);
  return { left, width };
}

/** Week-start ticks ("DD MMM") across the visible range — a day-by-day header would be unreadable at 32px/day. */
const MONTH_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function weekTicks(range: { start: Date; totalDays: number }): { dayOffset: number; label: string }[] {
  const ticks: { dayOffset: number; label: string }[] = [];
  for (let day = 0; day <= range.totalDays; day += 7) {
    const date = new Date(range.start.getTime() + day * DAY_MS);
    ticks.push({ dayOffset: day, label: `${date.getDate()} ${MONTH_SHORT[date.getMonth()]}` });
  }
  return ticks;
}

function GanttChart({
  rows,
  range,
  labelWidth,
  pxPerDay,
  scrollRef,
  drag,
  onStartDrag,
  onEditMilestone,
  onDeleteMilestone,
  onOpenTask,
  critical
}: {
  rows: GanttNode[];
  range: { start: Date; totalDays: number };
  labelWidth: number;
  pxPerDay: number;
  scrollRef: React.RefObject<HTMLDivElement>;
  drag: DragState | null;
  onStartDrag: (kind: DragState["kind"], node: GanttNode, clientX: number) => void;
  onEditMilestone: (id: string) => void;
  onDeleteMilestone: (id: string) => void;
  onOpenTask: (id: string) => void;
  /** `${kind}:${id}` keys on the critical chain — `null` when the toggle is off (see `ProjectGantt`). */
  critical: Set<string> | null;
}): React.ReactElement {
  const showContextMenu = useContextMenuApi();
  const chartWidth = range.totalDays * pxPerDay;
  // Where "today" falls on the time axis; absent when the plan lies entirely before or after it.
  const todayOffset = (Date.now() - range.start.getTime()) / DAY_MS;
  const todayX = todayOffset >= 0 && todayOffset <= range.totalDays ? todayOffset * pxPerDay : null;
  const chartHeight = rows.length * ROW_H;
  const ticks = weekTicks(range);

  const rowIndexByKey = new Map<string, number>();
  rows.forEach((row, index) => rowIndexByKey.set(`${row.kind}:${row.id}`, index));

  const arrows = rows.flatMap((row, index) => {
    if (row.kind === "header") return [];
    const rowGeo = barGeometry(previewNode(row, drag), range, pxPerDay);
    if (!rowGeo) return [];
    return row.dependencyIds.flatMap((depId) => {
      const depIndex = rowIndexByKey.get(`${row.kind}:${depId}`);
      if (depIndex === undefined) return [];
      const depGeo = barGeometry(previewNode(rows[depIndex], drag), range, pxPerDay);
      if (!depGeo) return [];
      const x1 = depGeo.left + depGeo.width;
      const y1 = depIndex * ROW_H + ROW_H / 2;
      const x2 = rowGeo.left;
      const y2 = index * ROW_H + ROW_H / 2;
      const midX = x1 + Math.max(6, (x2 - x1) / 2);
      const isCritical = Boolean(critical?.has(`${row.kind}:${row.id}`) && critical?.has(`${row.kind}:${depId}`));
      return [{ key: `${row.kind}:${row.id}:${depId}`, d: `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`, isCritical }];
    });
  });

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex">
        {/* Label column — the only place a milestone/task row is clickable; bars themselves are drag-only (see file comment). A blank spacer keeps it aligned under the ticks header, which lives in the scroll region on the right so it can never scroll out of sync with the bars. */}
        <div style={{ width: labelWidth }} className="shrink-0 border-r border-border">
          <div className="h-6 border-b border-border" />
          {rows.map((row) => {
            const rowMenuItems: (MenuItem | "separator")[] | null =
              row.kind === "milestone"
                ? [
                    { label: "Изменить веху", icon: Pencil, onSelect: () => onEditMilestone(row.id) },
                    { label: "Удалить веху", icon: Trash2, tone: "danger", onSelect: () => onDeleteMilestone(row.id) }
                  ]
                : row.kind === "task"
                  ? [{ label: "Открыть задачу", onSelect: () => onOpenTask(row.id) }]
                  : null;
            return (
            <div
              key={`${row.kind}:${row.id}`}
              style={{ height: ROW_H }}
              className="flex items-center gap-1 px-2 text-2xs"
              onContextMenu={(e) => showContextMenu(e, rowMenuItems)}
            >
              {row.kind === "header" ? (
                <span className="font-medium uppercase tracking-wide text-subtle-foreground">{row.title}</span>
              ) : row.kind === "milestone" ? (
                <>
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={row.title}>
                    {row.title}
                  </span>
                  {labelWidth < 180 ? (
                    <DropdownMenu
                      trigger={({ toggle }) => (
                        <IconButton label={`Действия вехи «${row.title}»`} size="sm" onClick={toggle}>
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </IconButton>
                      )}
                      items={rowMenuItems ?? []}
                    />
                  ) : (
                    <>
                      <IconButton label="Изменить веху" size="sm" onClick={() => onEditMilestone(row.id)}>
                        <Pencil className="h-3 w-3" />
                      </IconButton>
                      <IconButton label="Удалить веху" size="sm" tone="danger" onClick={() => onDeleteMilestone(row.id)}>
                        <Trash2 className="h-3 w-3" />
                      </IconButton>
                    </>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenTask(row.id)}
                  className={cx("min-w-0 flex-1 truncate pl-3 text-left text-muted-foreground hover:text-foreground", row.done && "line-through opacity-60")}
                  title={row.title}
                >
                  {row.title}
                </button>
              )}
            </div>
            );
          })}
        </div>

        {/* One scroll region for ticks + bars together — a separate header scroller would desync from the body on scroll. */}
        <div ref={scrollRef} className="orion-scroll min-w-0 flex-1 overflow-x-auto">
          <div style={{ width: chartWidth }} className="relative h-6 border-b border-border">
            {ticks.map((tick) => (
              <div
                key={tick.dayOffset}
                className="absolute top-0 h-full border-l border-white/5 pl-1 text-2xs leading-6 text-subtle-foreground"
                style={{ left: tick.dayOffset * pxPerDay }}
              >
                {todayX !== null && coveredByToday(tick.dayOffset * pxPerDay, todayX) ? null : tick.label}
              </div>
            ))}
            {todayX !== null ? (
              <div
                className="absolute top-0 z-10 h-full -translate-x-1/2 rounded-b bg-accent px-1 text-2xs font-medium leading-6 text-accent-foreground"
                style={{ left: Math.max(todayX, TODAY_HALF_W) }}
              >
                сегодня
              </div>
            ) : null}
          </div>
          <div style={{ width: chartWidth, height: chartHeight }} className="relative">
            {Array.from({ length: rows.length + 1 }, (_, i) => (
              <div key={i} className="absolute inset-x-0 border-t border-white/5" style={{ top: i * ROW_H }} />
            ))}

            {todayX !== null ? (
              <div className="pointer-events-none absolute inset-y-0 w-px bg-accent/70" style={{ left: todayX }} aria-hidden />
            ) : null}

            <svg className="pointer-events-none absolute inset-0" width={chartWidth} height={chartHeight}>
              <defs>
                <marker id="gantt-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" className="fill-subtle-foreground" />
                </marker>
                <marker id="gantt-arrow-critical" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" className="fill-destructive" />
                </marker>
              </defs>
              {arrows.map((arrow) => (
                <path
                  key={arrow.key}
                  d={arrow.d}
                  className={cx("fill-none", arrow.isCritical ? "stroke-destructive" : "stroke-subtle-foreground/60")}
                  strokeWidth={arrow.isCritical ? 2.25 : 1.5}
                  markerEnd={arrow.isCritical ? "url(#gantt-arrow-critical)" : "url(#gantt-arrow)"}
                />
              ))}
            </svg>

            {rows.map((row, index) => {
              if (row.kind === "header") return null;
              const display = previewNode(row, drag);
              const geo = barGeometry(display, range, pxPerDay);
              if (!geo) return null;
              const isDragging = drag?.node.kind === row.kind && drag?.node.id === row.id;
              const isCritical = critical?.has(`${row.kind}:${row.id}`) ?? false;
              const barTitle =
                (row.estimatedMinutes !== null ? `${row.title} · план ${formatDuration(row.estimatedMinutes)}` : row.title) +
                (isCritical ? " · на критическом пути" : "");
              return (
                <div
                  key={`${row.kind}:${row.id}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onStartDrag("move", row, e.clientX);
                  }}
                  style={{ top: index * ROW_H + 4, left: geo.left, width: geo.width, height: ROW_H - 8 }}
                  className={cx(
                    "absolute flex cursor-grab select-none items-center overflow-hidden rounded-md border text-2xs active:cursor-grabbing",
                    geo.width >= BAR_LABEL_MIN_PX && "px-1.5",
                    isCritical
                      ? "border-destructive/60 bg-destructive/15 text-foreground"
                      : row.kind === "milestone"
                        ? "border-accent/50 bg-accent/20 font-medium text-foreground"
                        : row.done
                          ? "border-success/30 bg-success/10 text-muted-foreground line-through opacity-70"
                          : row.blocked
                            ? "border-warning/40 bg-warning/10 text-foreground"
                            : "border-border bg-white/[0.06] text-foreground",
                    isDragging && "opacity-80 ring-1 ring-accent"
                  )}
                  title={barTitle}
                >
                  <div
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onStartDrag("resize-start", row, e.clientX);
                    }}
                    className="absolute inset-y-0 left-0 cursor-ew-resize"
                    style={{ width: EDGE_PX }}
                  />
                  {geo.width >= BAR_LABEL_MIN_PX ? <span className="truncate">{row.title}</span> : null}
                  <div
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onStartDrag("resize-end", row, e.clientX);
                    }}
                    className="absolute inset-y-0 right-0 cursor-ew-resize"
                    style={{ width: EDGE_PX }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
