"use client";

import { useAddProjectGoalPlan, useProjectGoals, useRemoveProjectGoalPlan } from "@orion/core-react";
import type { Goal, GoalPlan } from "@orion/shared-types";
import { Button, Card, IconButton, Select, useToast } from "@orion/ui";
import { Flag, X } from "lucide-react";
import { useState } from "react";
import type { ProjectOverviewSideSlotProps } from "../../lib/extensions/contracts";
import { describeAuthError, Meter, openEntity, openPanel, openProjectTask } from "../../lib/extensions/host-api";

/**
 * «Цели» on a project's overview (plugin projects-goals): which goals this project is a plan of, how far each goal is
 * and how much this project weighs in it — and linking to a goal right from the project, not only from «Цели».
 * Progress is the goal's own (computed from the tasks of all its plans), never entered here.
 */
export function ProjectGoalCard({ workspaceId, projectId }: ProjectOverviewSideSlotProps): React.ReactElement | null {
  const goals = useProjectGoals(workspaceId);
  const add = useAddProjectGoalPlan(workspaceId);
  const remove = useRemoveProjectGoalPlan(workspaceId);
  const { toast } = useToast();
  const [picked, setPicked] = useState("");

  if (goals.isLoading || goals.isError) return null;
  const all = goals.data ?? [];
  const linked: Array<{ goal: Goal; plan: GoalPlan }> = all.flatMap((goal) => goal.plans.filter((plan) => plan.projectId === projectId).map((plan) => ({ goal, plan })));
  const candidates = all.filter((goal) => goal.status === "active" && !goal.plans.some((plan) => plan.projectId === projectId));

  function link(): void {
    if (!picked) return;
    add.mutate(
      { goalId: picked, input: { projectId, weight: 1 } },
      {
        onSuccess: () => setPicked(""),
        onError: (error) => toast({ title: "Не удалось привязать к цели", description: describeAuthError(error), tone: "danger" })
      }
    );
  }

  return (
    <Card className="space-y-2 px-4 py-3" role="region" aria-label="Цели проекта">
      <h3 className="text-micro font-medium uppercase tracking-wide text-subtle-foreground">Цели</h3>
      {linked.length === 0 ? <p className="text-label text-muted-foreground">Проект пока не ведёт ни к одной цели.</p> : null}
      <ul className="space-y-2">
        {linked.map(({ goal, plan }) => {
          const totalWeight = goal.plans.reduce((sum, item) => sum + item.weight, 0);
          return (
            <li key={plan.id} className="space-y-1">
              <div className="flex items-center gap-1.5">
                <Flag className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                <button type="button" onClick={() => openEntity("goal", goal.id, goal.title)} className="min-w-0 flex-1 truncate text-left text-label text-foreground hover:underline">
                  {goal.title}
                </button>
                <span className="font-mono text-micro tabular-nums text-muted-foreground">{goal.progress === null ? "—" : `${Math.round(goal.progress)}%`}</span>
                <IconButton
                  label={`Отвязать от цели «${goal.title}»`}
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(
                      { goalId: goal.id, planId: plan.id },
                      { onError: (error) => toast({ title: "Не удалось отвязать", description: describeAuthError(error), tone: "danger" }) }
                    )
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </IconButton>
              </div>
              <Meter value={goal.progress ?? 0} tone={goal.progress === 100 ? "success" : "accent"} />
              <p className="text-micro text-subtle-foreground">
                {goal.plans.length > 1 ? `вклад проекта — ${plan.weight} из ${totalWeight} по весу, ещё проектов: ${goal.plans.length - 1}` : "единственный проект этой цели"}
                {goal.status !== "active" ? ` · ${goal.status === "achieved" ? "цель достигнута" : "цель отложена"}` : ""}
              </p>
              {goal.status === "active" && plan.nextTask ? (
                <button type="button" onClick={() => openProjectTask(projectId, plan.nextTask!.id, plan.nextTask!.title)} className="block max-w-full truncate text-left text-label text-accent hover:underline">
                  Дальше: {plan.nextTask.title}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {candidates.length > 0 ? (
        <div className="flex items-center gap-2 pt-1">
          <Select aria-label="Цель для проекта" value={picked} onChange={(event) => setPicked(event.target.value)} className="min-w-0 flex-1 text-xs">
            <option value="">Привязать к цели…</option>
            {candidates.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.title}
              </option>
            ))}
          </Select>
          <Button size="sm" disabled={!picked || add.isPending} onClick={link}>
            Привязать
          </Button>
        </div>
      ) : all.length === 0 ? (
        <Button size="sm" variant="ghost" onClick={() => openPanel("goals")}>
          Создать цель
        </Button>
      ) : null}
    </Card>
  );
}
