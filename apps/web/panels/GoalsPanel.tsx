"use client";

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
import { GOAL_STATUS_LABEL, goalStatusSchema, type Goal, type GoalStatus } from "@orion/shared-types";
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
  Select,
  Skeleton,
  useToast
} from "@orion/ui";
import { Flag, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeError } from "../lib/error-message";
import { shortDate } from "../lib/format";
import { openProject } from "../lib/panel-bus";
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

  function fail(message: string, error: unknown): void {
    toast({ title: message, description: describeError(error), tone: "danger" });
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      await create.mutateAsync({ title, description: "" });
      setTitle("");
    } catch (error) {
      fail("Не удалось создать цель", error);
    }
  }

  return (
    <PanelShell>
      <PanelHeader icon={Flag} title="Цели" subtitle={goals ? `${goals.filter((g) => g.status === "active").length} в работе` : undefined} />
      <PanelBody className="space-y-4">
        <form onSubmit={(event) => void submit(event)} className="flex max-w-xl gap-2">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Новая цель, например «Запустить экосистему»" maxLength={200} />
          <Button type="submit" size="sm" disabled={create.isPending || !title.trim()}>
            Добавить
          </Button>
        </form>

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (goals ?? []).length === 0 ? (
          <EmptyState
            icon={Flag}
            title="Целей пока нет"
            description="Цель объединяет несколько проектов-планов: добавьте её, затем привяжите проекты с весами."
          />
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(22rem,1fr))]">
            {(goals ?? []).map((goal) => {
              const free = (projects ?? []).filter((project) => !goal.plans.some((plan) => plan.projectId === project.id));
              return (
                <Card key={goal.id} className="space-y-3 p-4">
                  <div className="flex items-start gap-2">
                    <h3 className="min-w-0 flex-1 text-sm font-medium">{goal.title}</h3>
                    <Select
                      aria-label="Статус цели"
                      value={goal.status}
                      onChange={(event) =>
                        update.mutate(
                          { goalId: goal.id, input: { status: goalStatusSchema.parse(event.target.value) } },
                          { onError: (error) => fail("Не удалось изменить статус", error) }
                        )
                      }
                      className="w-auto"
                    >
                      {goalStatusSchema.options.map((status: GoalStatus) => (
                        <option key={status} value={status}>
                          {GOAL_STATUS_LABEL[status]}
                        </option>
                      ))}
                    </Select>
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
                          ? "Прогресс неизвестен — в планах нет задач"
                          : goal.unknownPlans > 0
                            ? `По ${goal.plans.length - goal.unknownPlans} из ${goal.plans.length} планов`
                            : "По всем планам"}
                      </span>
                      <span className="font-mono tabular-nums">{goal.progress === null ? "—" : `${goal.progress}%`}</span>
                    </div>
                    <ProgressBar value={goal.progress} />
                    {goal.dueAt ? <p className="text-2xs text-subtle-foreground">до {shortDate(goal.dueAt)}</p> : null}
                  </div>

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
                    <Select
                      aria-label="Добавить план (проект)"
                      value=""
                      onChange={(event) => {
                        const projectId = event.target.value;
                        if (projectId) addPlan.mutate({ goalId: goal.id, input: { projectId, weight: 1 } }, { onError: (error) => fail("Не удалось добавить план", error) });
                      }}
                    >
                      <option value="">+ Добавить план (проект)…</option>
                      {free.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
      </PanelBody>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить цель?"
        description={pendingDelete ? `«${pendingDelete.title}» — проекты-планы останутся нетронутыми.` : undefined}
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
