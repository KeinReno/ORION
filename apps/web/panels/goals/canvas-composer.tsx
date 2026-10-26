"use client";

import {
  useAddProjectGoalPlan,
  useCreateMilestone,
  useCreateProject,
  useCreateProjectGoal,
  useCreateTask
} from "@orion/core-react";
import { checkGoalParent, type Goal, type Project } from "@orion/shared-types";
import { Button, Input, Select, useToast } from "@orion/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Flag, FolderPlus, GitBranch, ListTodo, Milestone, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { describeError } from "../../lib/error-message";
import type { Star } from "../../lib/goal-constellation";
import styles from "./sky-canvas.module.css";

type Kind = "goal" | "project" | "task" | "milestone" | "existing";

const CHOICES: { kind: Kind; label: string; icon: typeof Flag }[] = [
  { kind: "goal", label: "Подцель", icon: Flag },
  { kind: "project", label: "Проект", icon: FolderPlus },
  { kind: "task", label: "Задача", icon: ListTodo },
  { kind: "milestone", label: "Веха", icon: Milestone },
  { kind: "existing", label: "Готовый проект", icon: FolderPlus }
];

interface CanvasComposerProps {
  workspaceId: string | undefined;
  parent: Star;
  contextTarget: boolean;
  goals: ReadonlyArray<Goal>;
  projects: ReadonlyArray<Project>;
  screenX: number;
  screenY: number;
  onClose: () => void;
  onOpenParent: () => void;
  onStartLink: () => void;
  onCreated: (starId: string) => void;
}

/** Creation is scoped to the selected goal or plan; every operation writes a real module entity. */
export function CanvasComposer({ workspaceId, parent, contextTarget, goals, projects, screenX, screenY, onClose, onOpenParent, onStartLink, onCreated }: CanvasComposerProps): React.ReactElement {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createGoal = useCreateProjectGoal(workspaceId);
  const createProject = useCreateProject(workspaceId);
  const addPlan = useAddProjectGoalPlan(workspaceId);
  const createTask = useCreateTask(workspaceId);
  const createMilestone = useCreateMilestone(workspaceId);
  const [kind, setKind] = useState<Kind | null>(null);
  const [title, setTitle] = useState("");
  const [projectChoice, setProjectChoice] = useState(parent.projectId ?? "new");
  const [newProjectName, setNewProjectName] = useState("");
  const [saving, setSaving] = useState(false);
  const firstChoiceRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { firstChoiceRef.current?.focus({ preventScroll: true }); }, []);

  const goal = goals.find((item) => item.id === parent.goalId);
  const parentGoalId = parent.kind === "goal" ? parent.goalId : goal?.id;
  const plans = goal?.plans ?? [];
  const availableProjects = projects.filter((project) => !plans.some((plan) => plan.projectId === project.id));
  const needsProject = kind === "task" || kind === "milestone";
  const selectedProject = plans.find((plan) => plan.projectId === projectChoice);
  const validTitle = kind === "existing" ? projectChoice !== "" : Boolean(title.trim());
  const canSave = Boolean(workspaceId && goal && kind && validTitle && (!needsProject || projectChoice !== "new" || newProjectName.trim()));

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSave || !goal || !kind || saving) return;
    setSaving(true);
    try {
      const name = title.trim();
      if (kind === "goal") {
        const created = await createGoal.mutateAsync({ title: name, description: "", successCriteria: [], parentId: parentGoalId, subWeight: 1 });
        onCreated(created.id);
      } else if (kind === "project" || kind === "existing") {
        const projectId = kind === "existing"
          ? projectChoice
          : (await createProject.mutateAsync({ name, description: "", status: "active", currency: "RUB" })).id;
        const updated = await addPlan.mutateAsync({ goalId: goal.id, input: { projectId, weight: 1 } });
        const plan = updated.plans.find((item) => item.projectId === projectId);
        onCreated(plan ? `${goal.id}:${plan.id}` : goal.id);
      } else {
        let projectId = projectChoice;
        let planId = selectedProject?.id;
        if (projectChoice === "new") {
          const project = await createProject.mutateAsync({ name: newProjectName.trim(), description: "", status: "active", currency: "RUB" });
          projectId = project.id;
          setProjectChoice(project.id);
        }
        if (!planId) {
          const updated = await addPlan.mutateAsync({ goalId: goal.id, input: { projectId, weight: 1 } });
          planId = updated.plans.find((item) => item.projectId === projectId)?.id;
        }
        if (kind === "task") {
          const task = await createTask.mutateAsync({ title: name, description: "", priority: "normal", checklist: [], projectId, milestoneId: parent.projectId === projectId ? parent.milestoneId : null });
          void queryClient.invalidateQueries({ queryKey: ["goals", workspaceId] });
          void queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] });
          onCreated(planId ? `${goal.id}:${planId}:task:${task.id}` : goal.id);
        } else {
          const milestone = await createMilestone.mutateAsync({ projectId, title: name, note: "", status: "planned", order: 0 });
          void queryClient.invalidateQueries({ queryKey: ["goals", workspaceId] });
          void queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] });
          onCreated(planId ? `${goal.id}:${planId}:${milestone.id}` : goal.id);
        }
      }
      onClose();
    } catch (error) {
      toast({ title: "Не удалось добавить узел", description: describeError(error), tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-canvas-composer data-expanded={kind !== null} className={styles.canvasComposer} style={{ left: `${Math.min(60, Math.max(3, screenX * 100))}%`, top: `${Math.min(35, Math.max(5, screenY * 100))}%` }} role="region" aria-label="Добавить в созвездие">
      <div className={styles.canvasComposerHeading}>
        <span>{kind ? "Новый элемент" : "Добавить рядом"} · {goal?.title ?? "цель"}</span>
        <button type="button" onClick={onClose} aria-label="Закрыть создание узла"><X size={16} /></button>
      </div>
      <div className={styles.canvasChoices} role="group" aria-label="Тип элемента">
        {CHOICES.filter((choice) =>
          (choice.kind !== "existing" || availableProjects.length > 0) &&
          (choice.kind !== "goal" || Boolean(parentGoalId && checkGoalParent(null, parentGoalId, goals).ok))
        ).map(({ kind: option, label, icon: Icon }, index) => (
          <button key={option} ref={index === 0 ? firstChoiceRef : undefined} type="button" aria-pressed={kind === option} onClick={() => { setKind(option); setTitle(""); setProjectChoice(option === "existing" ? availableProjects[0]?.id ?? "" : parent.projectId ?? plans[0]?.projectId ?? "new"); }}>
            <Icon size={15} aria-hidden /> {label}
          </button>
        ))}
      </div>
      {!kind && contextTarget ? <div className={styles.canvasContextActions} role="group" aria-label="Действия с узлом">
        <button type="button" onClick={onOpenParent}><ExternalLink size={15} aria-hidden />{parent.kind === "goal" ? "Открыть цель в списке" : parent.kind === "task" ? "Открыть задачу" : "Открыть проект"}</button>
        {parent.kind !== "plan" ? <button type="button" onClick={onStartLink}><GitBranch size={15} aria-hidden />Связать от этого узла</button> : null}
      </div> : null}
      {kind ? (
        <form onSubmit={(event) => void submit(event)} className={styles.canvasComposerForm}>
          {kind === "existing" ? (
            <label>Проект<Select autoFocus value={projectChoice} onChange={(event) => setProjectChoice(event.target.value)}>{availableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</Select></label>
          ) : (
            <label>{kind === "goal" ? "Название подцели" : kind === "project" ? "Название проекта" : kind === "task" ? "Название задачи" : "Название вехи"}<Input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={kind === "project" ? 120 : 200} placeholder="Что должно появиться?" /></label>
          )}
          {needsProject ? (
            <>
              <label>Проект плана<Select value={projectChoice} onChange={(event) => setProjectChoice(event.target.value)}>{plans.map((plan) => <option key={plan.projectId} value={plan.projectId}>{plan.projectName}</option>)}{projectChoice !== "new" && !selectedProject ? <option value={projectChoice}>{newProjectName.trim() || "Новый проект"} · привязать к цели</option> : null}<option value="new">+ Создать проект-план</option></Select></label>
              {projectChoice === "new" ? <label>Название нового проекта<Input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} maxLength={120} placeholder="Например, Первый этап" /></label> : null}
              <p>Задачи и вехи живут в проекте; задачи этого проекта влияют на прогресс цели.</p>
            </>
          ) : null}
          <div className={styles.canvasComposerActions}><Button type="button" size="sm" variant="ghost" onClick={onClose}>Отмена</Button><Button type="submit" size="sm" disabled={!canSave || saving}>{saving ? "Создаю…" : kind === "existing" ? "Связать" : "Создать"}</Button></div>
        </form>
      ) : <p className={styles.canvasComposerHint}>Выберите тип элемента · Esc закрывает меню</p>}
    </div>
  );
}
