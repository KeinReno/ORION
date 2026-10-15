"use client";

import {
  useAddProjectGoalPlan,
  useCreateProjectGoal,
  useRemoveProjectGoalPlan,
  useStartTimer,
  useUpdateProjectGoal,
  useUpdateProjectGoalPlan,
  useUpdateTask
} from "@orion/core-react";
import { GOAL_STATUS_LABEL, checkGoalParent, goalPace, goalStatusSchema, type Goal, type GoalStatus, type Project } from "@orion/shared-types";
import { Badge, Button, Card, Input, Select, Textarea, useToast } from "@orion/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ListTree, Play, Check, Trash2, X } from "lucide-react";
import { useState } from "react";
import { describeError } from "../../lib/error-message";
import { shortDate } from "../../lib/format";
import { STALLED_DAYS, validParents, type Star } from "../../lib/goal-constellation";
import { openProject } from "../../lib/panel-bus";
import { useEnabledModules } from "../../lib/use-enabled-modules";
import { STATE_LABEL } from "./sky-canvas";
import { GoalLinks } from "./goal-links";

function clampWeight(raw: string): number {
  return Math.min(100, Math.max(1, Math.round(Number(raw) || 1)));
}

/** `<input type="date">` value (local day) from an ISO instant. */
function dayValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local noon, so a day picked in any timezone is the same day when shown back. */
function dayToIso(value: string): string | null {
  return value ? new Date(`${value}T12:00:00`).toISOString() : null;
}

function PaceNote({ pace, progress }: { pace: ReturnType<typeof goalPace>; progress: number | null }): React.ReactElement {
  const tone = pace.state === "late" ? "danger" : pace.state === "behind" ? "warning" : pace.state === "on_track" ? "success" : "neutral";
  const text =
    pace.state === "late"
      ? "Срок прошёл, а цель не достигнута"
      : pace.state === "unknown"
        ? `Прошло ${pace.elapsed}% срока, прогресс пока неизвестен`
        : `Прошло ${pace.elapsed}% срока, сделано ${progress}% — ${pace.state === "behind" ? "отстаёт" : "по плану"}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={tone}>{pace.state === "late" ? "просрочено" : pace.state === "behind" ? "отстаёт" : pace.state === "on_track" ? "по плану" : "срок идёт"}</Badge>
      <span className="text-label text-subtle-foreground">{text}</span>
    </div>
  );
}

export interface GoalInspectorProps {
  workspaceId: string | undefined;
  star: Star;
  goals: ReadonlyArray<Goal>;
  projects: ReadonlyArray<Project>;
  onSelect: (id: string) => void;
  onDeleteGoal: (goal: Goal) => void;
  onShowInList: (goalId: string) => void;
  /** Jump to another goal's constellation (a shared project serves it too). */
  onOpenGoal: (goalId: string) => void;
  visibleLinkIds?: ReadonlySet<string>;
  onToggleVisible?: (id: string) => void;
}

/**
 * Everything you can do with the selected star, without leaving the sky: edit the goal,
 * grow it (sub-goal / plan), tune weights, and act on a plan's next task (start timer / done).
 */
export function GoalInspector({ workspaceId, star, goals, projects, onSelect, onDeleteGoal, onShowInList, onOpenGoal, visibleLinkIds, onToggleVisible }: GoalInspectorProps): React.ReactElement {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isEnabled } = useEnabledModules();
  const updateGoal = useUpdateProjectGoal(workspaceId);
  const createGoal = useCreateProjectGoal(workspaceId);
  const addPlan = useAddProjectGoalPlan(workspaceId);
  const updatePlan = useUpdateProjectGoalPlan(workspaceId);
  const removePlan = useRemoveProjectGoalPlan(workspaceId);
  const updateTask = useUpdateTask(workspaceId);
  const startTimer = useStartTimer(workspaceId);
  const [subTitle, setSubTitle] = useState("");

  const goal = goals.find((g) => g.id === star.goalId);
  if (!goal) return <Card className="p-4 text-label text-subtle-foreground">Эта звезда уже исчезла — выберите другую.</Card>;

  const fail = (message: string) => (error: unknown) => toast({ title: message, description: describeError(error), tone: "danger" });
  const refreshGoals = (): void => void queryClient.invalidateQueries({ queryKey: ["goals", workspaceId] });
  const plan = star.planId ? goal.plans.find((p) => p.id === star.planId) : undefined;

  if (star.kind === "milestone") {
    const milestone = plan?.milestones.find((m) => m.id === star.milestoneId);
    if (!plan || !milestone) return <Card className="p-4 text-label text-subtle-foreground">Эта веха уже изменилась — выберите другую.</Card>;
    const late = star.overdue > 0;
    return (
      <Card className="space-y-3 p-4" aria-label={`Веха ${milestone.title}`}>
        <p className="text-sm font-medium">{milestone.title}</p>
        <p className="text-label text-subtle-foreground">
          Веха проекта «{plan.projectName}» · {STATE_LABEL[star.state]}
          {milestone.tasks > 0 ? ` · ${milestone.closed}/${milestone.tasks} задач` : ""}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {milestone.dueAt ? <Badge tone={late ? "danger" : "neutral"}>{late ? "просрочена · " : "до "}{shortDate(milestone.dueAt)}</Badge> : null}
          {star.frontier ? <Badge tone="accent">сейчас здесь</Badge> : null}
        </div>
        <p className="text-2xs text-subtle-foreground">
          {plan.milestones.length > 4 ? `На карте показаны 4 из ${plan.milestones.length} вех — ближайшие к текущей.` : "Первая веха ниже, следующие ведут вверх к результату."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => openProject(plan.projectId, plan.projectName)}>
            Открыть проект
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => onSelect(`${goal.id}:${plan.id}`)}>
            К плану
          </Button>
        </div>
      </Card>
    );
  }

  if (star.kind === "plan") {
    if (!plan) return <Card className="p-4 text-label text-subtle-foreground">Этот план уже убран из цели.</Card>;
    const next = star.nextTask;
    const idleDays = star.lastActivityAt ? Math.floor((Date.now() - new Date(star.lastActivityAt).getTime()) / 86_400_000) : null;
    return (
      <Card className="space-y-3 p-4" aria-label={`План ${plan.projectName}`}>
        <div className="flex items-start gap-2">
          <button type="button" onClick={() => openProject(plan.projectId, plan.projectName)} className="min-w-0 flex-1 text-left text-sm font-medium hover:underline" title="Открыть проект">
            {plan.projectName}
          </button>
          {plan.projectArchived ? <Badge>архив</Badge> : null}
        </div>
        <p className="text-label text-subtle-foreground">
          План цели «{goal.title}» · {STATE_LABEL[star.state]}
          {plan.progress === null ? "" : ` · ${plan.closed}/${plan.tasks} задач`}
        </p>

        <div className="flex flex-wrap gap-1.5">
          {star.overdue > 0 ? <Badge tone="danger">просрочено: {star.overdue}</Badge> : null}
          {star.blocked > 0 ? <Badge tone="warning">ждёт другие задачи: {star.blocked}</Badge> : null}
          {star.stalled ? <Badge tone="warning">стоит {idleDays} дн.</Badge> : null}
        </div>

        {star.sharedWith.length > 0 ? (
          <div className="space-y-1 rounded-lg border border-border p-2.5">
            <p className="text-2xs uppercase tracking-wide text-subtle-foreground">Этот проект служит и другим целям</p>
            <div className="flex flex-wrap gap-1.5">
              {star.sharedWith.map((id) => (
                <Button key={id} type="button" size="sm" variant="ghost" onClick={() => onOpenGoal(id)}>
                  ✦ {goals.find((g) => g.id === id)?.title ?? "цель"}
                </Button>
              ))}
            </div>
            <p className="text-2xs text-subtle-foreground">Закрытая здесь задача двигает все эти цели сразу.</p>
          </div>
        ) : null}

        <div className="space-y-1.5 rounded-lg border border-border p-2.5">
          <p className="text-2xs uppercase tracking-wide text-subtle-foreground">Следующий шаг</p>
          {next ? (
            <>
              <p className="text-label">{next.title}</p>
              <p className="text-2xs text-subtle-foreground">
                {next.status === "in_progress" ? "уже в работе" : "готова к старту"}
                {next.dueAt ? ` · до ${shortDate(next.dueAt)}${next.overdue ? " (просрочена)" : ""}` : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                {isEnabled("time") ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={startTimer.isPending}
                    onClick={() =>
                      startTimer.mutate(
                        { taskId: next.id, projectId: plan.projectId, note: "" },
                        { onSuccess: () => toast({ title: "Таймер запущен", description: next.title }), onError: fail("Не удалось запустить таймер") }
                      )
                    }
                  >
                    <Play className="mr-1 h-3.5 w-3.5" />
                    Начать
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={updateTask.isPending}
                  onClick={() =>
                    updateTask.mutate(
                      { taskId: next.id, input: { status: "done" } },
                      {
                        onSuccess: () => {
                          refreshGoals();
                          toast({ title: "Задача закрыта", description: next.title });
                        },
                        onError: fail("Не удалось закрыть задачу")
                      }
                    )
                  }
                >
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Готово
                </Button>
              </div>
            </>
          ) : (
            <p className="text-label text-subtle-foreground">
              {plan.tasks === 0
                ? "В проекте нет задач — добавьте первую, и звезда загорится."
                : plan.tasks === plan.closed
                  ? "Все задачи закрыты."
                  : star.blocked > 0
                    ? "Все открытые задачи ждут других — разблокируйте одну из них."
                    : "Нет задач, готовых к старту."}
            </p>
          )}
        </div>

        <label className="flex items-center gap-2 text-label text-subtle-foreground">
          Вес плана в цели
          <input
            type="number"
            min={1}
            max={100}
            defaultValue={plan.weight}
            key={`${plan.id}-${plan.weight}`}
            aria-label={`Вес плана ${plan.projectName}`}
            onBlur={(event) => {
              const weight = clampWeight(event.target.value);
              if (weight !== plan.weight) updatePlan.mutate({ goalId: goal.id, planId: plan.id, weight }, { onError: fail("Не удалось изменить вес") });
            }}
            className="w-14 rounded border border-border bg-transparent px-1 py-0.5 text-right text-foreground"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => onSelect(goal.id)}>
            К цели
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              removePlan.mutate({ goalId: goal.id, planId: plan.id }, { onError: fail("Не удалось убрать план") });
              toast({
                title: "План убран из цели",
                description: "Проект остался на месте.",
                action: { label: "Отменить", onClick: () => addPlan.mutate({ goalId: goal.id, input: { projectId: plan.projectId, weight: plan.weight } }, { onError: fail("Не удалось вернуть план") }) }
              });
            }}
          >
            <X className="mr-1 h-3.5 w-3.5" />
            Убрать из цели
          </Button>
        </div>
      </Card>
    );
  }

  // ---- goal star ----
  const pace = goalPace(goal, new Date());
  const parentChoices = validParents(goals, goal.id);
  const attachable = projects.filter((p) => !goal.plans.some((pl) => pl.projectId === p.id));
  const canAddSub = checkGoalParent(null, goal.id, goals).ok;

  async function addSub(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    try {
      const created = await createGoal.mutateAsync({ title: subTitle, description: "", parentId: goal!.id, subWeight: 1 });
      setSubTitle("");
      onSelect(created.id);
    } catch (error) {
      fail("Не удалось создать подцель")(error);
    }
  }

  return (
    <Card className="space-y-3 p-4" aria-label={`Цель ${goal.title}`} key={`${goal.id}-${goal.updatedAt}`}>
      <Input
        defaultValue={goal.title}
        maxLength={200}
        aria-label="Название цели"
        onBlur={(event) => {
          const title = event.target.value.trim();
          if (title && title !== goal.title) updateGoal.mutate({ goalId: goal.id, input: { title } }, { onError: fail("Не удалось переименовать") });
          else event.target.value = goal.title;
        }}
        className="text-sm font-medium"
      />

      <p className="text-label text-subtle-foreground">
        {goal.progress === null ? "Прогресс неизвестен — в планах и подцелях нет задач" : `Прогресс ${goal.progress}%`}
        {goal.unknownPlans + goal.unknownSubGoals > 0 ? ` (не учтено: ${goal.unknownPlans + goal.unknownSubGoals} — ещё без задач)` : ""}
      </p>

      {pace.state !== "none" ? <PaceNote pace={pace} progress={goal.progress} /> : null}

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-2xs text-subtle-foreground">
          Статус
          <Select
            value={goal.status}
            aria-label="Статус цели"
            onChange={(event) => updateGoal.mutate({ goalId: goal.id, input: { status: goalStatusSchema.parse(event.target.value) } }, { onError: fail("Не удалось изменить статус") })}
          >
            {goalStatusSchema.options.map((status: GoalStatus) => (
              <option key={status} value={status}>
                {GOAL_STATUS_LABEL[status]}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-2xs text-subtle-foreground">
          Срок
          <Input
            type="date"
            defaultValue={dayValue(goal.dueAt)}
            aria-label="Срок цели"
            onBlur={(event) => {
              const dueAt = dayToIso(event.target.value);
              if (dueAt !== goal.dueAt && dayValue(dueAt) !== dayValue(goal.dueAt)) updateGoal.mutate({ goalId: goal.id, input: { dueAt } }, { onError: fail("Не удалось сменить срок") });
            }}
          />
        </label>
      </div>

      <label className="block space-y-1 text-2xs text-subtle-foreground">
        Зачем эта цель
        <Textarea
          defaultValue={goal.description}
          rows={3}
          maxLength={20_000}
          aria-label="Описание цели"
          placeholder="Что должно получиться и почему это важно"
          onBlur={(event) => {
            if (event.target.value !== goal.description) updateGoal.mutate({ goalId: goal.id, input: { description: event.target.value } }, { onError: fail("Не удалось сохранить описание") });
          }}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2 text-2xs text-subtle-foreground">
        <label className="flex items-center gap-1">
          Родитель
          <Select
            aria-label="Родительская цель"
            value={goal.parentId ?? ""}
            onChange={(event) => updateGoal.mutate({ goalId: goal.id, input: { parentId: event.target.value || null } }, { onError: fail("Не удалось переместить цель") })}
            className="w-auto"
          >
            <option value="">— верхний уровень —</option>
            {goals.filter((g) => parentChoices.has(g.id) || g.id === goal.parentId).map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </Select>
        </label>
        {goal.parentId ? (
          <label className="flex items-center gap-1">
            вес в родителе
            <input
              type="number"
              min={1}
              max={100}
              defaultValue={goal.subWeight}
              aria-label="Вес цели в родителе"
              onBlur={(event) => {
                const subWeight = clampWeight(event.target.value);
                if (subWeight !== goal.subWeight) updateGoal.mutate({ goalId: goal.id, input: { subWeight } }, { onError: fail("Не удалось изменить вес") });
              }}
              className="w-12 rounded border border-border bg-transparent px-1 py-0.5 text-right text-foreground"
            />
          </label>
        ) : null}
      </div>

      {canAddSub ? (
        <form onSubmit={(event) => void addSub(event)} className="flex gap-2">
          <Input value={subTitle} onChange={(event) => setSubTitle(event.target.value)} placeholder="Новая подцель…" aria-label={`Новая подцель для «${goal.title}»`} maxLength={200} />
          <Button type="submit" size="sm" disabled={createGoal.isPending || !subTitle.trim()}>
            <ListTree className="mr-1 h-3.5 w-3.5" />
            Добавить
          </Button>
        </form>
      ) : (
        <p className="text-2xs text-subtle-foreground">Глубже подцелей нет — это максимальная вложенность.</p>
      )}

      {attachable.length > 0 ? (
        <Select
          aria-label="Добавить план (проект)"
          value=""
          onChange={(event) => {
            const projectId = event.target.value;
            if (projectId) addPlan.mutate({ goalId: goal.id, input: { projectId, weight: 1 } }, { onError: fail("Не удалось добавить план") });
          }}
        >
          <option value="">+ Добавить план (проект)…</option>
          {attachable.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
      ) : null}

      <GoalLinks workspaceId={workspaceId} goalId={goal.id} goals={goals} visibleLinkIds={visibleLinkIds} onToggleVisible={onToggleVisible} />

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => onShowInList(goal.id)}>
          Показать в списке
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onDeleteGoal(goal)} className="text-destructive">
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          Удалить цель
        </Button>
      </div>
      <p className="text-2xs text-subtle-foreground">«Стоит» — план с открытыми задачами, в котором {STALLED_DAYS} дней ничего не менялось.</p>
    </Card>
  );
}
