"use client";

import { useAddProjectGoalPlan, useEntityLinks, useMilestones, useProjectGoalsHistory, useTasks, useUpdateMilestone, useUpdateProjectGoal, useUpdateTask } from "@orion/core-react";
import type { Goal, Project } from "@orion/shared-types";
import { Badge, Button, Card, SegmentedControl, useToast } from "@orion/ui";
import { ArrowLeft, GitBranch, Hand, History, Plus, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { describeError } from "../../lib/error-message";
import { shortDate } from "../../lib/format";
import { openEntity, openProject } from "../../lib/panel-bus";
import { buildConstellations, suggestCanvasPoint, type Lens, type Star } from "../../lib/goal-constellation";
import { goalsAt, progressDelta } from "../../lib/goal-history";
import { applyPins, loadPins, loadVisibleLinks, pinsOf, savePins, saveVisibleLinks, type SkyPins } from "../../lib/goal-sky-layout";
import { GoalInspector } from "./goal-inspector";
import { CanvasComposer } from "./canvas-composer";
import { KIND_LABEL, SkyCanvas, STATE_LABEL } from "./sky-canvas";
import styles from "./sky-canvas.module.css";
import { SkyOverview } from "./sky-overview";

/** How far back the "как было" slider goes. */
const HISTORY_WEEKS = 12;

export interface ConstellationViewProps {
  workspaceId: string | undefined;
  goals: ReadonlyArray<Goal>;
  projects: ReadonlyArray<Project>;
  focusedGoalId?: string | null;
  onFocusApplied?: (goalId: string) => void;
  onShowInList: (goalId: string) => void;
  onDeleteGoal: (goal: Goal) => void;
}

/** What the inspector shows while looking at the past: the star then vs now, nothing editable. */
function PastCard({ star, now }: { star: Star; now: Star | undefined }): React.ReactElement {
  const delta = progressDelta(star.progress, now?.progress ?? null);
  return (
    <Card className="space-y-2 p-4" aria-label={`Звезда ${star.label} в прошлом`}>
      <p className="text-sm font-medium">{star.label}</p>
      <p className="text-label text-subtle-foreground">
        Тогда: {star.progress === null ? "прогресс неизвестен (задач ещё не было)" : `${star.progress}%`}
        {" · "}Сейчас: {now ? (now.progress === null ? "неизвестен" : `${now.progress}%`) : "звезды больше нет"}
      </p>
      {delta !== null ? <Badge tone={delta > 0 ? "success" : "neutral"}>{delta > 0 ? `+${delta} п.п. с тех пор` : "без изменений"}</Badge> : null}
      <p className="text-2xs text-subtle-foreground">Это снимок: править его нельзя. Вернитесь на «сейчас», чтобы действовать.</p>
    </Card>
  );
}

/**
 * Second view of the Goals panel, two levels:
 *  - the sky: every goal as a small constellation, achieved ones in the «Небосвод достижений»;
 *  - one constellation, zoomed: pan / zoom, an inspector with all the actions, lenses
 *    (progress / focus / stuck), drag-and-drop editing and a hand-arranged layout.
 * A time slider ("как было") shows either level as it was up to 12 weeks ago, read-only.
 * Layout and rules live in `lib/goal-constellation.ts`; this file only wires them to the API.
 */
export function ConstellationView({ workspaceId, goals, projects, focusedGoalId, onFocusApplied, onShowInList, onDeleteGoal }: ConstellationViewProps): React.ReactElement {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateGoal = useUpdateProjectGoal(workspaceId);
  const addPlan = useAddProjectGoalPlan(workspaceId);
  const updateTask = useUpdateTask(workspaceId);
  const updateMilestone = useUpdateMilestone(workspaceId);
  const [openRoot, setOpenRoot] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>("progress");
  const [arrange, setArrange] = useState(false);
  const [editLinks, setEditLinks] = useState(false);
  const [pins, setPins] = useState<SkyPins>({});
  const [visibleLinkIds, setVisibleLinkIds] = useState<string[]>([]);
  const [timeline, setTimeline] = useState(false);
  const [sliderValue, setSliderValue] = useState(HISTORY_WEEKS);
  const [composer, setComposer] = useState<{ x: number; y: number; screenX: number; screenY: number; parentId: string; contextStarId: string | null } | null>(null);
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const appliedFocus = useRef<string | null>(null);

  useEffect(() => {
    if (!composer) return undefined;
    const dismissOutside = (event: PointerEvent): void => {
      if (!(event.target as Element).closest("[data-canvas-composer]")) setComposer(null);
    };
    const dismissEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setComposer(null);
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissEscape);
    };
  }, [composer]);

  // The arrangement is a personal, per-browser convenience (not shared with teammates).
  useEffect(() => {
    if (workspaceId) {
      setPins(loadPins(workspaceId));
      setVisibleLinkIds(loadVisibleLinks(workspaceId));
    }
  }, [workspaceId]);

  const historyQuery = useProjectGoalsHistory(workspaceId, HISTORY_WEEKS, timeline);
  const history = historyQuery.data;
  const pastIndex = timeline && history && sliderValue < history.points.length - 1 ? sliderValue : null;
  const readOnly = pastIndex !== null;
  const pastAt = pastIndex !== null && history ? new Date(history.points[pastIndex]!) : null;
  const activeDetailWorkspace = openRoot && !readOnly ? workspaceId : undefined;
  const { data: tasks = [] } = useTasks(activeDetailWorkspace);
  const { data: milestones = [] } = useMilestones(activeDetailWorkspace);

  const shownGoals = useMemo(() => (pastIndex !== null && history ? goalsAt(goals, history, pastIndex) : [...goals]), [goals, history, pastIndex]);
  const constellations = useMemo(
    () => buildConstellations(shownGoals, pastAt ?? new Date(), openRoot && !readOnly ? tasks : []).map((c) => applyPins(c, pins)),
    // pastAt is derived from pastIndex + history, both already listed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shownGoals, pins, pastIndex, history, openRoot, readOnly, tasks]
  );
  useEffect(() => {
    // `appliedFocus` only guards against re-running this effect for the SAME still-pending request
    // while `constellations` keeps recomputing (goals/pins changing) — it must not survive past the
    // request being cleared, or focusing the same goal a second time (a real null -> id -> null -> id
    // sequence from the caller) would be silently ignored.
    if (!focusedGoalId) { appliedFocus.current = null; return; }
    if (appliedFocus.current === focusedGoalId) return;
    const home = constellations.find((item) => item.stars.some((star) => star.id === focusedGoalId && star.kind === "goal"));
    if (!home) return;
    appliedFocus.current = focusedGoalId;
    setOpenRoot(home.rootId);
    setSelectedId(focusedGoalId);
    setLens("progress");
    onFocusApplied?.(focusedGoalId);
  }, [focusedGoalId, constellations, onFocusApplied]);
  // Today's stars, only to say "тогда X% → сейчас Y%" while looking at the past.
  const todayStars = useMemo(
    () => (readOnly ? new Map(buildConstellations(goals).flatMap((c) => c.stars.map((s) => [s.id, s] as const))) : new Map<string, Star>()),
    [goals, readOnly]
  );

  const open = constellations.find((c) => c.rootId === openRoot) ?? null;
  const dependencyLinks = useMemo(() => {
    if (!open) return [];
    const edges: { from: string; to: string }[] = [];
    for (const target of open.stars) {
      if (target.kind === "task" && target.taskId) {
        const task = tasks.find((item) => item.id === target.taskId);
        for (const dependencyId of task?.dependencyIds ?? []) {
          const source = open.stars.find((star) => star.kind === "task" && star.taskId === dependencyId && star.goalId === target.goalId);
          if (source) edges.push({ from: source.id, to: target.id });
        }
      } else if (target.kind === "milestone" && target.milestoneId) {
        const milestone = milestones.find((item) => item.id === target.milestoneId);
        for (const dependencyId of milestone?.dependencyIds ?? []) {
          const source = open.stars.find((star) => star.kind === "milestone" && star.milestoneId === dependencyId && star.goalId === target.goalId);
          if (source) edges.push({ from: source.id, to: target.id });
        }
      }
    }
    return edges;
  }, [open, tasks, milestones]);
  const selectedGoalId = open?.stars.find((star) => star.id === selectedId && star.kind === "goal")?.goalId;
  const selectedLinks = useEntityLinks(workspaceId, "goal", selectedGoalId ?? "");
  const visibleLinks = useMemo(() => new Set(visibleLinkIds), [visibleLinkIds]);

  function toggleVisibleLink(id: string): void {
    setVisibleLinkIds((previous) => {
      const next = previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id];
      if (workspaceId) saveVisibleLinks(workspaceId, next);
      return next;
    });
  }
  // A constellation that disappeared (goal deleted / moved under another / not yet created in the past) closes itself.
  useEffect(() => {
    if (openRoot && !open) {
      setOpenRoot(null);
      setSelectedId(null);
    }
  }, [openRoot, open]);

  const freeProjects = useMemo(() => {
    const planned = new Set(goals.flatMap((g) => g.plans.map((p) => p.projectId)));
    return projects.filter((p) => !planned.has(p.id));
  }, [goals, projects]);
  const titles = useMemo(() => new Map(goals.map((g) => [g.id, g.title])), [goals]);

  const fail = (message: string) => (error: unknown) => toast({ title: message, description: describeError(error), tone: "danger" });

  function reparent(goalId: string, parentId: string): void {
    const before = goals.find((g) => g.id === goalId)?.parentId ?? null;
    updateGoal.mutate(
      { goalId, input: { parentId } },
      {
        onSuccess: () =>
          toast({
            title: "Цель перенесена",
            description: `Теперь она часть «${titles.get(parentId) ?? ""}».`,
            action: { label: "Отменить", onClick: () => updateGoal.mutate({ goalId, input: { parentId: before } }, { onError: fail("Не удалось вернуть цель") }) }
          }),
        onError: fail("Не удалось переместить цель")
      }
    );
  }

  /** Jump into the constellation that contains `goalId` and select that goal's star. */
  function openGoal(goalId: string): void {
    const home = constellations.find((c) => c.stars.some((s) => s.id === goalId));
    if (!home) return;
    setOpenRoot(home.rootId);
    setSelectedId(goalId);
    setLens("progress");
    setLinkSource(null);
    setComposer(null);
  }

  function activateStar(starId: string, stars: ReadonlyArray<Star>): void {
    const star = stars.find((item) => item.id === starId);
    if (!star) return;
    if (star.kind === "goal") onShowInList(star.goalId);
    else if (star.kind === "task" && star.taskId) openEntity("task", star.taskId, star.label);
    else if (star.projectId) openProject(star.projectId, star.label);
  }

  function attachProject(projectId: string, goalId: string): void {
    const project = projects.find((p) => p.id === projectId);
    addPlan.mutate(
      { goalId, input: { projectId, weight: 1 } },
      {
        onSuccess: (goal) => {
          setSelectedId(`${goalId}:${goal.plans.find((p) => p.projectId === projectId)?.id ?? ""}`);
          toast({ title: "Проект стал планом цели", description: `«${project?.name ?? ""}» → «${titles.get(goalId) ?? ""}»` });
        },
        onError: fail("Не удалось добавить план")
      }
    );
  }

  /** Explicitly connect two real entities. A dependency points from prerequisite to the work that waits for it. */
  function connect(source: Star, target: Star): void {
    if (source.id === target.id) return;
    if (source.kind === "task" && target.kind === "task" && source.taskId && target.taskId) {
      const task = tasks.find((item) => item.id === target.taskId);
      if (!task || task.dependencyIds.includes(source.taskId)) return;
      updateTask.mutate({ taskId: target.taskId, input: { dependencyIds: [...task.dependencyIds, source.taskId] } }, {
        onSuccess: () => setSelectedId(target.id),
        onError: fail("Не удалось связать задачи")
      });
    } else if (source.kind === "milestone" && target.kind === "milestone" && source.milestoneId && target.milestoneId && source.projectId === target.projectId) {
      const milestone = milestones.find((item) => item.id === target.milestoneId);
      if (!milestone || milestone.dependencyIds.includes(source.milestoneId)) return;
      updateMilestone.mutate({ milestoneId: target.milestoneId, input: { dependencyIds: [...milestone.dependencyIds, source.milestoneId] } }, {
        onSuccess: () => setSelectedId(target.id),
        onError: fail("Не удалось связать вехи")
      });
    } else if (source.kind === "task" && target.kind === "milestone" && source.taskId && target.milestoneId && source.projectId === target.projectId) {
      updateTask.mutate({ taskId: source.taskId, input: { milestoneId: target.milestoneId } }, {
        onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["goals", workspaceId] }); setSelectedId(target.id); },
        onError: fail("Не удалось привязать задачу")
      });
    } else if (source.kind === "goal" && target.kind === "goal") {
      reparent(source.goalId, target.goalId);
    } else {
      toast({ title: "Такая связь недоступна", description: "Свяжите две задачи, две вехи одного проекта, задачу с вехой или две цели.", tone: "danger" });
      return;
    }
    setLinkSource(null);
  }

  function selectStar(id: string, stars: ReadonlyArray<Star>): void {
    const target = stars.find((star) => star.id === id);
    const source = stars.find((star) => star.id === linkSource);
    if (editLinks && source && target) connect(source, target);
    else setSelectedId(id);
  }

  function pin(starId: string, x: number, y: number): void {
    setPins((prev) => {
      const next = { ...prev, [starId]: { x, y } };
      if (workspaceId) savePins(workspaceId, next);
      return next;
    });
  }

  function resetPins(starIds: string[]): void {
    setPins((prev) => {
      const next = { ...prev };
      for (const id of starIds) delete next[id];
      if (workspaceId) savePins(workspaceId, next);
      return next;
    });
  }

  const timelineBar = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant={timeline ? "outline" : "ghost"}
          aria-pressed={timeline}
          onClick={() => {
            setTimeline(!timeline);
            setSliderValue(HISTORY_WEEKS);
          }}
        >
          <History className="mr-1 h-3.5 w-3.5" />
          Как было
        </Button>
        {timeline ? (
          history ? (
            <>
              <input
                type="range"
                min={0}
                max={HISTORY_WEEKS}
                step={1}
                value={sliderValue}
                onChange={(event) => setSliderValue(Number(event.target.value))}
                aria-label="Момент в прошлом"
                aria-valuetext={pastAt ? shortDate(pastAt.toISOString()) : "сейчас"}
                className="w-64 max-w-full accent-accent"
              />
              <span className="font-mono text-label tabular-nums text-muted-foreground">
                {pastAt ? `${shortDate(pastAt.toISOString())} · ${HISTORY_WEEKS - sliderValue} нед. назад` : "сейчас"}
              </span>
            </>
          ) : historyQuery.isError ? (
            <span className="text-label text-destructive">Не удалось загрузить историю</span>
          ) : (
            <span className="text-label text-subtle-foreground">Загружаю историю…</span>
          )
        ) : null}
      </div>
      {readOnly ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-2xs text-subtle-foreground">
          Снимок восстановлен по датам задач, поэтому править его нельзя. Не видно: задачи, удалённые с тех пор, прежние статусы целей, вехи и следующие шаги. Цели, созданные позже, на нём отсутствуют.
        </p>
      ) : null}
    </div>
  );

  // ---- level 2: one constellation ----
  if (open) {
    const selected = open.stars.find((s) => s.id === selectedId) ?? open.stars.find((s) => s.id === open.rootId)!;
    const pinned = pinsOf(open, pins);
    return (
      <div
        className="space-y-3"
        style={{ containerType: "inline-size" }}
        onKeyDown={(event) => {
          // Delete on a focused goal star asks to delete the goal (never a silent delete).
          const target = (event.target as Element).closest("[data-star]");
          if (readOnly || event.key !== "Delete" || !target) return;
          const star = open.stars.find((s) => s.id === target.getAttribute("data-star"));
          const goal = star?.kind === "goal" ? goals.find((g) => g.id === star.goalId) : undefined;
          if (goal) onDeleteGoal(goal);
        }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" variant="ghost" onClick={() => { setOpenRoot(null); setComposer(null); setLinkSource(null); }}>
            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
            Все созвездия
          </Button>
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{titles.get(open.rootId) ?? open.stars[0]?.label}</h2>
          {!readOnly ? (
            <>
              <Button type="button" size="sm" variant="outline" onClick={() => { const point = suggestCanvasPoint(open.stars, selected); setComposer({ ...point, screenX: point.x / 560, screenY: point.y / 420, parentId: selected.id, contextStarId: null }); }} aria-label="Добавить элемент в созвездие">
                <Plus className="mr-1 h-3.5 w-3.5" /> Добавить узел
              </Button>
              <Button type="button" size="sm" variant={arrange ? "outline" : "ghost"} aria-pressed={arrange} onClick={() => { setArrange(!arrange); setEditLinks(false); }} title="Меняет только личное расположение звёзд на этом устройстве">
                <Hand className="mr-1 h-3.5 w-3.5" />
                Расположить
              </Button>
              <Button type="button" size="sm" variant={editLinks ? "outline" : "ghost"} aria-pressed={editLinks} onClick={() => { setEditLinks(!editLinks); setLinkSource(null); setArrange(false); setComposer(null); }} title="Перенос подцели или добавление проекта меняет связи для всего пространства">
                <GitBranch className="mr-1 h-3.5 w-3.5" />
                Изменить связи
              </Button>
              {pinned.length > 0 ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => resetPins(pinned)}>
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />
                  Сбросить расположение
                </Button>
              ) : null}
            </>
          ) : null}
          <SegmentedControl<Lens>
            aria-label="Линза"
            value={lens}
            onChange={setLens}
            size="sm"
            options={[
              { value: "progress", label: "Прогресс" },
              { value: "focus", label: "Фокус" },
              { value: "stuck", label: "Застряло" }
            ]}
          />
        </div>

        {timelineBar}

        {!readOnly && editLinks ? <div className={styles.canvasLinkBar}>
          <GitBranch size={16} aria-hidden />
          <span>{linkSource ? `Теперь выберите узел, который зависит от «${open.stars.find((star) => star.id === linkSource)?.label ?? "выбранного"}». Для задачи → веха задача войдёт в этап.` : "Выберите исходный узел и нажмите «Связать от этого узла», затем выберите второй."}</span>
          {linkSource ? <Button type="button" size="sm" variant="ghost" onClick={() => setLinkSource(null)}>Отмена</Button> : <Button type="button" size="sm" variant="outline" onClick={() => setLinkSource(selected.id)}>Связать от этого узла</Button>}
        </div> : null}

        <div className="grid min-w-0 items-start gap-4 [@container(min-width:850px)]:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-2">
            <div className={styles.canvasStage}>
              {open.stars.length === 1 ? <div className={styles.canvasFirstHint}>Это ваша цель. Нажмите ПКМ на свободном месте, чтобы добавить первый узел.</div> : null}
              <div className={`${styles.atlasWideMap} ${open.stars.length === 1 ? styles.canvasFirstMap : ""}`}><SkyCanvas
              constellation={open}
              goals={shownGoals}
              lens={lens}
              selectedId={selectedId}
              selectedLinks={readOnly ? [] : (selectedLinks.data?.items ?? [])}
              visibleLinkIds={visibleLinks}
              dependencyLinks={dependencyLinks}
              mode="full"
              onSelect={(id) => selectStar(id, open.stars)}
              onActivate={readOnly || arrange || editLinks ? undefined : (id) => activateStar(id, open.stars)}
              onReparent={readOnly || !editLinks ? undefined : reparent}
              onDropProject={readOnly || !editLinks ? undefined : attachProject}
              arrange={arrange && !readOnly}
              onPin={readOnly || !arrange ? undefined : pin}
              onCanvasPrimaryClick={() => { setSelectedId(null); setLinkSource(null); setComposer(null); }}
              onCanvasContextMenu={readOnly ? undefined : (x, y, screenX, screenY, starId) => {
                const target = open.stars.find((star) => star.id === starId) ?? selected;
                const point = starId ? suggestCanvasPoint(open.stars, target) : { x, y };
                if (starId) setSelectedId(starId);
                setArrange(false);
                setEditLinks(false);
                setLinkSource(null);
                setComposer({ ...point, screenX, screenY, parentId: target.id, contextStarId: starId });
              }}
            /></div>
              {!readOnly && composer ? <CanvasComposer
                key={`${composer.x}-${composer.y}-${composer.parentId}`}
                workspaceId={workspaceId}
                parent={open.stars.find((star) => star.id === composer.parentId) ?? selected}
                contextTarget={composer.contextStarId !== null}
                goals={goals}
                projects={projects}
                screenX={composer.screenX} screenY={composer.screenY}
                onClose={() => setComposer(null)}
                onOpenParent={() => { activateStar(composer.parentId, open.stars); setComposer(null); }}
                onStartLink={() => { setSelectedId(composer.parentId); setLinkSource(composer.parentId); setEditLinks(true); setArrange(false); setComposer(null); }}
                onCreated={(starId) => { setSelectedId(starId); pin(starId, composer.x, composer.y); }}
              /> : null}
            </div>
            {open.stars.length > 1 ? (
              <div className={styles.atlasCompactRoute} aria-label="Маршрут к цели">
                <p className={styles.atlasRouteHeading}>МАРШРУТ К РЕЗУЛЬТАТУ · СНИЗУ ВВЕРХ</p>
                {[...open.stars].sort((a, b) => b.y - a.y || a.x - b.x).map((star) => (
                  <button key={star.id} type="button" className={styles.atlasRouteStar} data-selected={star.id === selected.id} onClick={() => selectStar(star.id, open.stars)}>
                    <span className={styles.atlasRouteSymbol} data-kind={star.kind} aria-hidden>{star.kind === "goal" ? "✦" : star.kind === "milestone" ? "◆" : star.kind === "task" ? "▪" : "◯"}</span>
                    <span className={styles.atlasRouteText}><strong>{star.label}</strong><small>{KIND_LABEL[star.kind]} · {STATE_LABEL[star.state]}</small></span>
                    <span className={styles.atlasRouteProgress}>{star.progress === null ? "—" : `${star.progress}%`}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <p className="text-2xs text-subtle-foreground">ПКМ открывает меню создания. ЛКМ выбирает узел, двойной ЛКМ открывает его запись; ЛКМ по пустому полю снимает выделение. Перетащите поле для обзора, Ctrl + колесо меняет масштаб. «Расположить» меняет только ваш рисунок, «Изменить связи» — структуру цели для пространства.</p>
            {!readOnly && editLinks && freeProjects.length > 0 ? (
              <div className="rounded-lg border border-dashed border-border p-2.5">
                <p className="mb-1.5 text-2xs uppercase tracking-wide text-subtle-foreground">Свободные проекты · перетащите на цель или выберите в панели справа</p>
                  <div className="flex flex-wrap gap-1.5">
                    {freeProjects.map((project) => (
                      <span
                        key={project.id}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData("application/x-orion-project", project.id);
                          event.dataTransfer.effectAllowed = "copy";
                        }}
                        className="cursor-grab rounded-full border border-border px-2.5 py-1 text-label hover:border-accent/70 active:cursor-grabbing"
                      >
                        ✦ {project.name}
                      </span>
                    ))}
                  </div>
              </div>
            ) : null}
          </div>

          {readOnly ? (
            <PastCard star={selected} now={todayStars.get(selected.id)} />
          ) : selectedId === null ? (
            <Card className="space-y-2 p-4" aria-label="Поле созвездия">
              <p className="text-sm font-medium">Поле созвездия</p>
              <p className="text-label text-subtle-foreground">Выберите узел ЛКМ, чтобы увидеть его действия. ПКМ на поле откроет меню создания; двойной ЛКМ по узлу откроет запись.</p>
              <Button type="button" size="sm" variant="outline" onClick={() => { const point = suggestCanvasPoint(open.stars, selected); setComposer({ ...point, screenX: point.x / 560, screenY: point.y / 420, parentId: selected.id, contextStarId: null }); }}>Добавить узел</Button>
            </Card>
          ) : (
            <GoalInspector
              workspaceId={workspaceId}
              star={selected}
              goals={goals}
              projects={projects}
              tasks={tasks}
              milestones={milestones}
              onSelect={setSelectedId}
              onDeleteGoal={onDeleteGoal}
              onShowInList={onShowInList}
              onOpenGoal={openGoal}
              visibleLinkIds={visibleLinks}
              onToggleVisible={toggleVisibleLink}
            />
          )}
        </div>
      </div>
    );
  }

  // ---- level 1: the whole sky ----
  return (
    <div className="space-y-4">
      {timelineBar}
      <SkyOverview
        constellations={constellations}
        goals={shownGoals}
        onOpen={(rootId) => {
          setOpenRoot(rootId);
          setLinkSource(null);
          setComposer(null);
          const constellation = constellations.find((item) => item.rootId === rootId);
          setSelectedId(constellation?.stars.find((star) => star.frontier)?.id ?? constellation?.stars.at(-1)?.id ?? rootId);
          setLens("progress");
        }}
      />
    </div>
  );
}
