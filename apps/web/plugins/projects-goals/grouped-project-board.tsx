"use client";

import { useProjectGoals } from "@orion/core-react";
import type { Goal, Project } from "@orion/shared-types";
import { Button } from "@orion/ui";
import { ArrowUpRight, Flag, FolderKanban } from "lucide-react";
import type { ProjectBoardGroupedSlotProps } from "../../lib/extensions/contracts";
import { openEntity } from "../../lib/extensions/host-api";

function ProjectLinks({ projects, onOpenProject }: { projects: ReadonlyArray<Project>; onOpenProject: (project: Project) => void }): React.ReactElement {
  return (
    <div className="grid gap-2 [@container(min-width:640px)]:grid-cols-2">
      {projects.map((project) => (
        <button key={project.id} type="button" onClick={() => onOpenProject(project)} className="group flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card/60 px-3 py-3 text-left transition-colors hover:border-accent/50 hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-accent"><FolderKanban className="h-4 w-4" aria-hidden /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{project.name}</span><span className="text-2xs text-muted-foreground">{project.counts.tasks} задач</span></span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{project.progress}%</span>
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-subtle-foreground group-hover:text-accent" aria-hidden />
        </button>
      ))}
    </div>
  );
}

function GoalGroup({ goal, projects, onOpenProject }: { goal: Goal; projects: ReadonlyArray<Project>; onOpenProject: (project: Project) => void }): React.ReactElement {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card/30 p-4" aria-label={`Проекты цели «${goal.title}»`}>
      <header className="flex flex-wrap items-center gap-2">
        <Flag className="h-4 w-4 text-accent" aria-hidden />
        <h2 className="min-w-0 flex-1 text-sm font-medium">{goal.title}</h2>
        <span className="font-mono text-label tabular-nums text-muted-foreground">{goal.progress === null ? "—" : `${goal.progress}%`}</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => openEntity("goal", goal.id, goal.title)}>К цели</Button>
      </header>
      <ProjectLinks projects={projects} onOpenProject={onOpenProject} />
    </section>
  );
}

/** A project may appear under several goals; every card opens the same original project. */
export function GroupedProjectBoard({ workspaceId, projects, onOpenProject }: ProjectBoardGroupedSlotProps): React.ReactElement {
  const goals = useProjectGoals(workspaceId);
  if (goals.isLoading) return <p className="px-2 py-6 text-label text-muted-foreground">Загружаю связи проектов и целей…</p>;
  if (goals.isError) return (
    <div className="space-y-2 rounded-xl border border-destructive/40 p-4">
      <p className="text-label">Не удалось загрузить связи с целями.</p>
      <Button type="button" size="sm" variant="outline" onClick={() => void goals.refetch()}>Повторить</Button>
    </div>
  );
  const available = new Map(projects.map((project) => [project.id, project]));
  const linked = new Set<string>();
  const groups = (goals.data ?? []).map((goal) => {
    const members = goal.plans.flatMap((plan) => {
      const project = available.get(plan.projectId);
      if (!project) return [];
      linked.add(project.id);
      return [project];
    });
    return { goal, members };
  }).filter((item) => item.members.length > 0);
  const unlinked = projects.filter((project) => !linked.has(project.id));
  return (
    <div className="space-y-4">
      <p className="text-label text-muted-foreground">Один проект может помогать нескольким целям. Здесь он показан в каждой из них, а данные проекта остаются общими.</p>
      {groups.map(({ goal, members }) => <GoalGroup key={goal.id} goal={goal} projects={members} onOpenProject={onOpenProject} />)}
      {unlinked.length > 0 ? (
        <section className="space-y-3 rounded-2xl border border-dashed border-border p-4" aria-label="Проекты без цели">
          <h2 className="text-sm font-medium">Без привязки к цели <span className="font-mono text-xs text-muted-foreground">· {unlinked.length}</span></h2>
          <ProjectLinks projects={unlinked} onOpenProject={onOpenProject} />
        </section>
      ) : null}
      {projects.length === 0 ? <p className="text-label text-muted-foreground">В текущем фильтре нет проектов.</p> : null}
    </div>
  );
}
