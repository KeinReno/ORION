"use client";

import { CapturesSection } from "../components/captures-section";
import {
  useAddProjectGoalPlan,
  useCreateProjectGoal,
  useDeleteProjectGoal,
  useProjectGoals,
  useProjects,
  useRemoveProjectGoalPlan,
  useUpdateProjectGoal,
  useUpdateProjectGoalPlan
} from "@orion/core-react";
import { GOAL_STATUS_LABEL, checkGoalParent, goalStatusSchema, type Goal } from "@orion/shared-types";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  PanelBody,
  PanelHeader,
  PanelShell,
  SegmentedControl,
  Combobox,
  GlideSelect,
  Skeleton,
  useToast
} from "@orion/ui";
import { Flag, ListTree, Trash2, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { ConstellationView } from "./goals/constellation-view";
import { describeError } from "../lib/error-message";
import { shortDate } from "../lib/format";
import { openProject, useGoalFocusRequest } from "../lib/panel-bus";
import { useActiveWorkspace } from "../lib/use-active-workspace";

function ProgressBar({ value }: { value: number | null }): React.ReactElement {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
      aria-label={value === null ? "Прогресс неизвестен" : `Прогресс ${value}%`}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      {value === null ? null : <div className="h-full rounded-full bg-accent" style={{ width: `${value}%` }} />}
    </div>
  );
}

/**
 * Global goals (plugin `projects-goals`): one outcome served by several plans. A plan is a
 * project with a weight; goal progress is computed from those projects' tasks and is never
 * typed in. A plan without tasks is shown as "нет задач" and left out of the percentage.
 */
export function GoalsPanel(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { toast } = useToast();
  const { data: goals, isLoading } = useProjectGoals(workspaceId);
  const { data: projects } = useProjects(workspaceId);
  const create = useCreateProjectGoal(workspaceId);
  const update = useUpdateProjectGoal(workspaceId);
  const remove = useDeleteProjectGoal(workspaceId);
  const addPlan = useAddProjectGoalPlan(workspaceId);
  const updatePlan = useUpdateProjectGoalPlan(workspaceId);
  const removePlan = useRemoveProjectGoalPlan(workspaceId);

  const [title, setTitle] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Goal | null>(null);
  const [subFor, setSubFor] = useState<string | null>(null);
  const [subTitle, setSubTitle] = useState("");
  const [view, setView] = useState<"list" | "sky">("sky");
  const [requestedGoalId, setRequestedGoalId] = useState<string | null>(null);
  // `request` changes on every focusGoal() call, even to the same goal (a fresh nonce) — depending on
  // it, not on request?.id, is what lets jumping back to the same goal a second time keep working.
  const request = useGoalFocusRequest();

  useEffect(() => {
    if (request) setRequestedGoalId(request.id);
  }, [request]);

  useEffect(() => {
    if (!request || !goals?.some((goal) => goal.id === request.id)) return;
    setView("sky");
  }, [request, goals]);

  function showInList(goalId: string): void {
    setView("list");
    // The list mounts on the next frame; wait for it before scrolling to the card.
    requestAnimationFrame(() => document.getElementById(`goal-${goalId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }

  const allGoals = goals ?? [];
  const childrenOf = (parentId: string): Goal[] => allGoals.filter((g) => g.parentId === parentId);
  // A parent that points outside the list is shown top-level rather than vanishing.
  const roots = allGoals.filter((g) => !g.parentId || !allGoals.some((p) => p.id === g.parentId));

  function fail(message: string, error: unknown): void {
    toast({ title: message, description: describeError(error), tone: "danger" });
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      const goal = await create.mutateAsync({ title: title.trim(), description: "", successCriteria: [], subWeight: 1 });
      setTitle("");
      setView("sky");
      setRequestedGoalId(goal.id);
    } catch (error) {
      fail("Не удалось создать цель", error);
    }
  }

  async function submitSub(event: FormEvent, parentId: string): Promise<void> {
    event.preventDefault();
    try {
      await create.mutateAsync({ title: subTitle, description: "", successCriteria: [], parentId, subWeight: 1 });
      setSubTitle("");
      setSubFor(null);
    } catch (error) {
      fail("Не удалось создать подцель", error);
    }
  }

  function renderGoal(goal: Goal, depth: number): React.ReactElement {
    const free = (projects ?? []).filter((project) => !goal.plans.some((plan) => plan.projectId === project.id));
    const parts = goal.plans.length + goal.subGoalCount;
    const unknown = goal.unknownPlans + goal.unknownSubGoals;
    const parentOptions = allGoals.filter((g) => g.id !== goal.id && checkGoalParent(goal.id, g.id, allGoals).ok);
    return (
      <div key={goal.id} id={`goal-${goal.id}`} className="space-y-3" role="group" aria-label={`Цель ${goal.title}`}>
        <div className={depth > 0 ? "ml-5 border-l border-border pl-3" : ""}>
          <Card className="space-y-3 p-4">
            <div className="flex items-start gap-2">
              <h3 className="min-w-0 flex-1 text-sm font-medium">{goal.title}</h3>
              <div className="w-36 shrink-0">
                <GlideSelect
                  label="Статус цели"
                  options={goalStatusSchema.options.map((status) => GOAL_STATUS_LABEL[status])}
                  value={GOAL_STATUS_LABEL[goal.status]}
                  onChange={(label) => {
                    const next = goalStatusSchema.options.find((status) => GOAL_STATUS_LABEL[status] === label);
                    if (next) {
                      update.mutate(
                        { goalId: goal.id, input: { status: next } },
                        { onError: (error) => fail("Не удалось изменить статус", error) }
                      );
                    }
                  }}
                />
              </div>
              <button
                type="button"
                aria-label="Удалить цель"
                onClick={() => setPendingDelete(goal)}
                className="rounded p-1 text-subtle-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-1">
              <div className="flex items-baseline justify-between text-label">
                <span className="text-muted-foreground">
                  {goal.progress === null
                    ? "Прогресс неизвестен — в планах и подцелях нет задач"
                    : unknown > 0
                      ? `По ${parts - unknown} из ${parts} (планы и подцели)`
                      : goal.subGoalCount > 0
                        ? "По всем планам и подцелям"
                        : "По всем планам"}
                </span>
                <span className="font-mono tabular-nums">{goal.progress === null ? "—" : `${goal.progress}%`}</span>
              </div>
              <ProgressBar value={goal.progress} />
              {goal.dueAt ? <p className="text-2xs text-subtle-foreground">до {shortDate(goal.dueAt)}</p> : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-2xs text-subtle-foreground">
              <label className="flex min-w-0 items-center gap-1">
                Родитель
                <span className="w-48">
                  <Combobox
                    label={`Родительская цель для «${goal.title}»`}
                    value={goal.parentId ?? ""}
                    onChange={(parentId) =>
                      update.mutate(
                        { goalId: goal.id, input: { parentId: parentId || null } },
                        { onError: (error) => fail("Не удалось переместить цель", error) }
                      )
                    }
                    items={[{ id: "", label: "— верхний уровень —" }, ...parentOptions.map((item) => ({ id: item.id, label: item.title }))]}
                  />
                </span>
              </label>
              {goal.parentId ? (
                <label className="flex items-center gap-1">
                  вес в родителе
                  <input
                    type="number"
                    min={1}
                    max={100}
                    defaultValue={goal.subWeight}
                    aria-label={`Вес подцели «${goal.title}» в родителе`}
                    onBlur={(event) => {
                      const weight = Math.min(100, Math.max(1, Math.round(Number(event.target.value) || 1)));
                      if (weight !== goal.subWeight) {
                        update.mutate({ goalId: goal.id, input: { subWeight: weight } }, { onError: (error) => fail("Не удалось изменить вес", error) });
                      }
                    }}
                    className="w-12 rounded border border-border bg-transparent px-1 py-0.5 text-right"
                  />
                </label>
              ) : null}
              {depth < 2 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-expanded={subFor === goal.id}
                  onClick={() => {
                    setSubFor(subFor === goal.id ? null : goal.id);
                    setSubTitle("");
                  }}
                >
                  <ListTree className="mr-1 h-3.5 w-3.5" />
                  Подцель
                </Button>
              ) : null}
            </div>
            {subFor === goal.id ? (
              <form onSubmit={(event) => void submitSub(event, goal.id)} className="flex gap-2">
                <Input
                  autoFocus
                  value={subTitle}
                  onChange={(event) => setSubTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setSubFor(null);
                  }}
                  placeholder="Название подцели"
                  aria-label={`Название подцели для «${goal.title}»`}
                  maxLength={200}
                />
                <Button type="submit" size="sm" disabled={create.isPending || !subTitle.trim()}>
                  Добавить
                </Button>
              </form>
            ) : null}

            <ul className="space-y-1.5">
              {goal.plans.map((plan) => (
                <li key={plan.id} className="space-y-1 rounded-lg border border-border px-2.5 py-1.5">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openProject(plan.projectId, plan.projectName)}
                      className="min-w-0 flex-1 truncate text-left text-label hover:underline"
                      title="Открыть проект"
                    >
                      {plan.projectName}
                    </button>
                    {plan.projectArchived ? <Badge>архив</Badge> : null}
                    <label className="flex items-center gap-1 text-2xs text-subtle-foreground">
                      вес
                      <input
                        type="number"
                        min={1}
                        max={100}
                        defaultValue={plan.weight}
                        aria-label={`Вес плана ${plan.projectName}`}
                        onBlur={(event) => {
                          const weight = Math.min(100, Math.max(1, Math.round(Number(event.target.value) || 1)));
                          if (weight !== plan.weight) {
                            updatePlan.mutate({ goalId: goal.id, planId: plan.id, weight }, { onError: (error) => fail("Не удалось изменить вес", error) });
                          }
                        }}
                        className="w-12 rounded border border-border bg-transparent px-1 py-0.5 text-right"
                      />
                    </label>
                    <button
                      type="button"
                      aria-label="Убрать план из цели"
                      onClick={() => removePlan.mutate({ goalId: goal.id, planId: plan.id }, { onError: (error) => fail("Не удалось убрать план", error) })}
                      className="rounded p-0.5 text-subtle-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <ProgressBar value={plan.progress} />
                    <span className="shrink-0 font-mono text-2xs tabular-nums text-subtle-foreground">
                      {plan.progress === null ? "нет задач" : `${plan.closed}/${plan.tasks}`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            {free.length > 0 ? (
              <Combobox
                label="Добавить план (проект)"
                value=""
                onChange={(projectId) => {
                  if (projectId) addPlan.mutate({ goalId: goal.id, input: { projectId, weight: 1 } }, { onError: (error) => fail("Не удалось добавить план", error) });
                }}
                items={[{ id: "", label: "+ Добавить план (проект)…" }, ...free.map((project) => ({ id: project.id, label: project.name }))]}
              />
            ) : null}

            <details className="group text-label">
              <summary className="cursor-pointer text-2xs text-subtle-foreground hover:text-foreground">Идеи и заметки по цели</summary>
              <div className="mt-2">
                <CapturesSection workspaceId={workspaceId} anchorType="goal" anchorId={goal.id} />
              </div>
            </details>
          </Card>
        </div>
        {childrenOf(goal.id).map((child) => renderGoal(child, depth + 1))}
      </div>
    );
  }

  return (
    <PanelShell>
      <PanelHeader icon={Flag} title="Цели" subtitle={goals ? `${goals.filter((g) => g.status === "active").length} в работе` : undefined} />
      <PanelBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <form onSubmit={(event) => void submit(event)} className="flex min-w-0 max-w-xl flex-1 gap-2">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Новая цель, например «Запустить экосистему»" maxLength={200} />
            <Button type="submit" size="sm" disabled={create.isPending || !title.trim()}>
              Добавить
            </Button>
          </form>
          <SegmentedControl<"list" | "sky">
            aria-label="Вид целей"
            value={view}
            onChange={setView}
            size="sm"
            options={[
              { value: "sky", label: "Созвездия" },
              { value: "list", label: "Список" }
            ]}
          />
        </div>

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (goals ?? []).length === 0 ? (
          <EmptyState
            icon={Flag}
            title="Целей пока нет"
            description="Цель объединяет несколько проектов-планов: добавьте её, затем привяжите проекты с весами."
          />
        ) : view === "sky" ? (
          <ConstellationView
            workspaceId={workspaceId}
            goals={allGoals}
            projects={projects ?? []}
            focusedGoalId={requestedGoalId}
            onFocusApplied={(goalId) => setRequestedGoalId((current) => current === goalId ? null : current)}
            onShowInList={showInList}
            onDeleteGoal={setPendingDelete}
          />
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(22rem,1fr))]">
            {roots.map((goal) => renderGoal(goal, 0))}
          </div>
        )}
      </PanelBody>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить цель?"
        description={pendingDelete ? `«${pendingDelete.title}» — проекты-планы останутся нетронутыми${pendingDelete.subGoalCount > 0 ? ", а подцели станут целями верхнего уровня" : ""}.` : undefined}
        onConfirm={() => {
          const goal = pendingDelete;
          setPendingDelete(null);
          if (goal) remove.mutate(goal.id, { onError: (error) => fail("Не удалось удалить цель", error) });
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </PanelShell>
  );
}
