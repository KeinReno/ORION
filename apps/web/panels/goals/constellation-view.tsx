"use client";

import { useAddProjectGoalPlan, useUpdateProjectGoal } from "@orion/core-react";
import type { Goal, Project } from "@orion/shared-types";
import { Badge, Button, SegmentedControl, useToast } from "@orion/ui";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { describeError } from "../../lib/error-message";
import { shortDate } from "../../lib/format";
import { buildConstellations, skyHealth, type Lens, type SkyHealth } from "../../lib/goal-constellation";
import { GoalInspector } from "./goal-inspector";
import { SkyCanvas } from "./sky-canvas";

const HEALTH_BADGE: Record<SkyHealth["tone"], { tone: "success" | "warning" | "accent" | "neutral"; label: string }> = {
  done: { tone: "success", label: "достигнуто" },
  attention: { tone: "warning", label: "требует внимания" },
  ok: { tone: "accent", label: "на ходу" },
  idle: { tone: "neutral", label: "нет следующего шага" }
};

export interface ConstellationViewProps {
  workspaceId: string | undefined;
  goals: ReadonlyArray<Goal>;
  projects: ReadonlyArray<Project>;
  onShowInList: (goalId: string) => void;
  onDeleteGoal: (goal: Goal) => void;
}

/**
 * Second view of the Goals panel, two levels:
 *  - the sky: every top-level goal as a small constellation with its health and next step;
 *  - one constellation, zoomed: pan / zoom, an inspector with all the actions, lenses
 *    (progress / focus / stuck) and drag-and-drop editing (projects from the tray onto a
 *    goal star, goal stars onto another goal star).
 * Layout and rules live in `lib/goal-constellation.ts`; this file only wires them to the API.
 */
export function ConstellationView({ workspaceId, goals, projects, onShowInList, onDeleteGoal }: ConstellationViewProps): React.ReactElement {
  const { toast } = useToast();
  const updateGoal = useUpdateProjectGoal(workspaceId);
  const addPlan = useAddProjectGoalPlan(workspaceId);
  const [openRoot, setOpenRoot] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>("progress");

  const constellations = useMemo(() => buildConstellations(goals), [goals]);
  const open = constellations.find((c) => c.rootId === openRoot) ?? null;
  // A constellation that disappeared (goal deleted / moved under another) closes itself.
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

  // ---- level 2: one constellation ----
  if (open) {
    const selected = open.stars.find((s) => s.id === selectedId) ?? open.stars.find((s) => s.id === open.rootId)!;
    return (
      <div
        className="space-y-3"
        onKeyDown={(event) => {
          // Delete on a focused goal star asks to delete the goal (never a silent delete).
          const target = (event.target as Element).closest("[data-star]");
          if (event.key !== "Delete" || !target) return;
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
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{titles.get(open.rootId)}</h2>
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

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-2">
            <SkyCanvas
              constellation={open}
              goals={goals}
              lens={lens}
              selectedId={selected.id}
              mode="full"
              onSelect={setSelectedId}
              onReparent={reparent}
              onDropProject={attachProject}
            />
            <p className="text-2xs text-subtle-foreground">
              Яркость — прогресс · пунктирное кольцо — задач ещё нет · пульс — следующий шаг готов · красная точка — просрочено · жёлтая — ждёт других задач · пунктир вокруг — стоит · толщина линии и размер — вес.
              Колесо — масштаб, перетаскивание — панорама, стрелки — переход по ветвям.
            </p>
            <div className="rounded-lg border border-dashed border-border p-2.5">
              <p className="mb-1.5 text-2xs uppercase tracking-wide text-subtle-foreground">Свободные звёзды — перетащите проект на звезду цели, и он станет планом</p>
              {freeProjects.length === 0 ? (
                <p className="text-label text-subtle-foreground">Все проекты уже служат какой-нибудь цели.</p>
              ) : (
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
              )}
            </div>
          </div>

          <GoalInspector
            workspaceId={workspaceId}
            star={selected}
            goals={goals}
            projects={projects}
            onSelect={setSelectedId}
            onDeleteGoal={onDeleteGoal}
            onShowInList={onShowInList}
          />
        </div>
      </div>
    );
  }

  // ---- level 1: the whole sky ----
  const healths = constellations.map((c) => skyHealth(c));
  const attention = healths.filter((h) => h.tone === "attention").length;
  const moving = healths.filter((h) => h.tone === "ok").length;
  return (
    <div className="space-y-4">
      <p className="text-label text-muted-foreground">
        {constellations.length} {constellations.length === 1 ? "созвездие" : "созвездий"}
        {` · на ходу: ${moving} · требуют внимания: ${attention}`}. Нажмите на созвездие, чтобы войти в него.
      </p>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]">
        {constellations.map((constellation, index) => {
          const health = healths[index]!;
          const root = constellation.stars.find((s) => s.id === constellation.rootId)!;
          const badge = HEALTH_BADGE[health.tone];
          return (
            <button
              key={constellation.rootId}
              type="button"
              onClick={() => {
                setOpenRoot(constellation.rootId);
                setSelectedId(constellation.rootId);
                setLens("progress");
              }}
              aria-label={`Открыть созвездие «${root.label}»`}
              className="space-y-2 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <SkyCanvas constellation={constellation} goals={goals} lens="progress" selectedId={null} mode="mini" />
              <div className="flex items-center gap-2 px-1">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{root.label}</span>
                <span className="font-mono text-label tabular-nums text-muted-foreground">{root.progress === null ? "—" : `${root.progress}%`}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 px-1">
                <Badge tone={badge.tone}>{badge.label}</Badge>
                {health.overdue > 0 ? <Badge tone="danger">просрочено: {health.overdue}</Badge> : null}
                {health.blocked > 0 ? <Badge tone="warning">ждёт: {health.blocked}</Badge> : null}
                {health.stalled > 0 ? <Badge tone="warning">стоит: {health.stalled}</Badge> : null}
                {root.dueAt ? <span className="text-2xs text-subtle-foreground">до {shortDate(root.dueAt)}</span> : null}
              </div>
              {health.next?.nextTask ? (
                <p className="truncate px-1 text-2xs text-subtle-foreground">
                  Дальше: {health.next.nextTask.title} <span className="opacity-70">· {health.next.label}</span>
                </p>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
