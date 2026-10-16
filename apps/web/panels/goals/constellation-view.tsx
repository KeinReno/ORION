"use client";

import { useAddProjectGoalPlan, useEntityLinks, useProjectGoalsHistory, useUpdateProjectGoal } from "@orion/core-react";
import type { Goal, Project } from "@orion/shared-types";
import { Badge, Button, Card, SegmentedControl, useToast } from "@orion/ui";
import { ArrowLeft, ArrowUp, Hand, History, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { describeError } from "../../lib/error-message";
import { shortDate } from "../../lib/format";
import { buildConstellations, type Lens, type Star } from "../../lib/goal-constellation";
import { goalsAt, progressDelta } from "../../lib/goal-history";
import { applyPins, loadPins, loadVisibleLinks, pinsOf, savePins, saveVisibleLinks, type SkyPins } from "../../lib/goal-sky-layout";
import { GoalInspector } from "./goal-inspector";
import { SkyCanvas } from "./sky-canvas";
import styles from "./sky-canvas.module.css";
import { SkyOverview } from "./sky-overview";

/** How far back the "как было" slider goes. */
const HISTORY_WEEKS = 12;

export interface ConstellationViewProps {
  workspaceId: string | undefined;
  goals: ReadonlyArray<Goal>;
  projects: ReadonlyArray<Project>;
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
export function ConstellationView({ workspaceId, goals, projects, onShowInList, onDeleteGoal }: ConstellationViewProps): React.ReactElement {
  const { toast } = useToast();
  const updateGoal = useUpdateProjectGoal(workspaceId);
  const addPlan = useAddProjectGoalPlan(workspaceId);
  const [openRoot, setOpenRoot] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>("progress");
  const [arrange, setArrange] = useState(false);
  const [pins, setPins] = useState<SkyPins>({});
  const [visibleLinkIds, setVisibleLinkIds] = useState<string[]>([]);
  const [timeline, setTimeline] = useState(false);
  const [sliderValue, setSliderValue] = useState(HISTORY_WEEKS);

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

  const shownGoals = useMemo(() => (pastIndex !== null && history ? goalsAt(goals, history, pastIndex) : [...goals]), [goals, history, pastIndex]);
  const constellations = useMemo(
    () => buildConstellations(shownGoals, pastAt ?? new Date()).map((c) => applyPins(c, pins)),
    // pastAt is derived from pastIndex + history, both already listed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shownGoals, pins, pastIndex, history]
  );
  // Today's stars, only to say "тогда X% → сейчас Y%" while looking at the past.
  const todayStars = useMemo(
    () => (readOnly ? new Map(buildConstellations(goals).flatMap((c) => c.stars.map((s) => [s.id, s] as const))) : new Map<string, Star>()),
    [goals, readOnly]
  );

  const open = constellations.find((c) => c.rootId === openRoot) ?? null;
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
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpenRoot(null)}>
            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
            Все созвездия
          </Button>
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{titles.get(open.rootId) ?? open.stars[0]?.label}</h2>
          {!readOnly ? (
            <>
              <Button type="button" size="sm" variant={arrange ? "outline" : "ghost"} aria-pressed={arrange} onClick={() => setArrange(!arrange)} title="Перетаскивайте звёзды, чтобы расположить их по-своему (Shift + перетаскивание делает то же)">
                <Hand className="mr-1 h-3.5 w-3.5" />
                Расположить
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

        <div className="grid min-w-0 items-start gap-4 [@container(min-width:850px)]:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-2">
            {open.stars.length === 1 ? (
              <div className={`relative flex min-h-[18rem] flex-col items-center justify-center overflow-hidden rounded-xl border border-accent/25 px-6 py-8 text-center ${styles.sky}`}>
                <div className="pointer-events-none absolute inset-x-1/2 top-0 h-44 w-44 -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" aria-hidden />
                <Sparkles className="relative mb-4 h-8 w-8 text-accent" aria-hidden />
                <p className="relative max-w-sm text-base font-semibold text-foreground">У результата пока нет маршрута</p>
                <p className="relative mt-2 max-w-sm text-label leading-relaxed text-subtle-foreground">Добавьте подцель или проект в панели рядом. Они станут узлами пути, по которому можно двигаться к цели.</p>
                <ArrowUp className="relative my-3 h-5 w-5 text-accent/70" aria-hidden />
                <span className="relative max-w-xs truncate text-label font-medium text-accent">{selected.label}</span>
              </div>
            ) : <SkyCanvas
              constellation={open}
              goals={shownGoals}
              lens={lens}
              selectedId={selected.id}
              selectedLinks={readOnly ? [] : (selectedLinks.data?.items ?? [])}
              visibleLinkIds={visibleLinks}
              mode="full"
              onSelect={setSelectedId}
              onReparent={readOnly ? undefined : reparent}
              onDropProject={readOnly ? undefined : attachProject}
              arrange={arrange && !readOnly}
              onPin={readOnly ? undefined : pin}
            />}
            {open.stars.length > 1 ? <p className="text-2xs text-subtle-foreground">Читайте путь снизу вверх: от первой вехи к результату. Выберите узел, чтобы увидеть действие. Прокрутка листает страницу; Ctrl + колесо меняет масштаб карты.</p> : null}
            {!readOnly && freeProjects.length > 0 ? (
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
          ) : (
            <GoalInspector
              workspaceId={workspaceId}
              star={selected}
              goals={goals}
              projects={projects}
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
          const constellation = constellations.find((item) => item.rootId === rootId);
          setSelectedId(constellation?.stars.find((star) => star.frontier)?.id ?? constellation?.stars.at(-1)?.id ?? rootId);
          setLens("progress");
        }}
      />
    </div>
  );
}
