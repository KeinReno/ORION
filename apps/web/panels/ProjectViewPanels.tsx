"use client";

import { useMilestones, useProject, useProjects, useTasks, useUpdateTask } from "@orion/core-react";
import type { Task } from "@orion/shared-types";
import { Button, EmptyState, PanelBody, PanelHeader, PanelShell, Skeleton, useToast } from "@orion/ui";
import { useQueryClient } from "@tanstack/react-query";
import { FolderOpen, GanttChartSquare, ListTodo, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { describeError } from "../lib/error-message";
import { openPanel } from "../lib/panel-bus";
import type { PanelComponentProps } from "../lib/panel-registry";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { useSlotContributions } from "../lib/extensions/slot";
import { ShareGrantSection } from "../components/share-grant-section";
import { ProjectMaterials } from "./projects/materials";
import { ProjectTasks } from "./projects/project-tasks";

/**
 * Large views of ONE project as panels of their own (UI-06 / ADR-0003): the plan
 * beside the overview, or on a second monitor. They render the very same components
 * the project's tabs render (`ProjectGantt`, `MaterialsTab`) and read the same API
 * through the same hooks — there is no copy of the data, so an edit in one window
 * shows in the other. The panel is identified by `kind:projectId`; access is
 * re-checked when it opens (the project is fetched with the viewer's own rights —
 * a stale panel id grants nothing).
 */
function useProjectView(params: PanelComponentProps["params"], api: PanelComponentProps["api"], label: string) {
  const projectId = params?.instanceId;
  const { workspace } = useActiveWorkspace();
  const query = useProject(workspace?.id, projectId);
  const name = query.data?.name;
  // The tab was opened with a placeholder (or restored from a saved layout): keep it
  // in step with the real, possibly renamed, project.
  useEffect(() => {
    if (name) api?.setTitle(`${label} · ${name}`);
  }, [api, name, label]);
  return { projectId, workspaceId: workspace?.id, ...query };
}

function ViewFrame({
  icon,
  label,
  query,
  children
}: {
  icon: typeof GanttChartSquare;
  label: string;
  query: ReturnType<typeof useProjectView>;
  children: (project: NonNullable<ReturnType<typeof useProjectView>["data"]>) => React.ReactNode;
}): React.ReactElement {
  const { projectId, data, isLoading, isError, error, refetch, isFetched } = query;
  if (!projectId) {
    return (
      <PanelShell>
        <PanelBody>
          <EmptyState icon={icon} title="Проект не выбран" description="Откройте вид из страницы проекта." />
        </PanelBody>
      </PanelShell>
    );
  }
  if (isError) {
    return (
      <PanelShell>
        <PanelBody>
          <EmptyState
            icon={TriangleAlert}
            tone="danger"
            title="Не удалось загрузить проект"
            description={describeError(error)}
            action={
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                Повторить
              </Button>
            }
          />
        </PanelBody>
      </PanelShell>
    );
  }
  if (isLoading || !data) {
    return (
      <PanelShell>
        <PanelBody>
          {isFetched && !data ? (
            <EmptyState icon={icon} title="Проект не найден" description="Возможно, он был удалён или недоступен." />
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </PanelBody>
      </PanelShell>
    );
  }
  return (
    <PanelShell>
      <PanelHeader
        icon={icon}
        title={label}
        subtitle={
          <button
            type="button"
            onClick={() => openPanel(`project:${data.id}`, data.name)}
            className="truncate hover:text-foreground hover:underline"
            title="Открыть страницу проекта"
          >
            {data.name}
          </button>
        }
      />
      {children(data)}
    </PanelShell>
  );
}

export function ProjectPlanPanel({ params, api }: PanelComponentProps): React.ReactElement {
  const query = useProjectView(params, api, "План");
  // The plan is the projects-planning plugin's tab; this panel only hosts the very same component.
  const PlanView = useSlotContributions("projects.tabs").find((contribution) => contribution.meta?.tabId === "plan")?.component;
  return (
    <ViewFrame icon={GanttChartSquare} label="План" query={query}>
      {(project) => (
        <PanelBody className="[container-type:inline-size]">
          {PlanView ? <PlanView workspaceId={query.workspaceId} projectId={project.id} /> : null}
        </PanelBody>
      )}
    </ViewFrame>
  );
}

export function ProjectMaterialsPanel({ params, api }: PanelComponentProps): React.ReactElement {
  const query = useProjectView(params, api, "Материалы");
  const { isEnabled } = useEnabledModules();
  return (
    <ViewFrame icon={FolderOpen} label="Материалы" query={query}>
      {(project) => (
        <PanelBody className="[container-type:inline-size]">
          <ProjectMaterials
            workspaceId={query.workspaceId}
            project={project}
            notesOn={isEnabled("notes")}
            documentsOn={isEnabled("documents")}
            onAddNote={() => openPanel(`project:${project.id}`, project.name)}
          />
        </PanelBody>
      )}
    </ViewFrame>
  );
}

/** The project's tasks (matrix / board / list / tree / links + the task pane) as a panel of its own. */
export function ProjectTasksPanel({ params, api }: PanelComponentProps): React.ReactElement {
  const query = useProjectView(params, api, "Задачи");
  const workspaceId = query.workspaceId;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isEnabled } = useEnabledModules();
  const tasksOn = isEnabled("tasks");
  const { data: allTasks, isLoading } = useTasks(tasksOn ? workspaceId : undefined);
  const { data: milestones } = useMilestones(workspaceId, query.projectId);
  const { data: workspaceProjects } = useProjects(workspaceId);
  const updateTask = useUpdateTask(workspaceId);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const tasks = useMemo(() => (allTasks ?? []).filter((task) => task.projectId === query.projectId), [allTasks, query.projectId]);

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ["project", workspaceId, query.projectId] });
    void queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] });
  }
  function toggle(task: Task): void {
    updateTask.mutate(
      { taskId: task.id, input: { status: task.status === "done" ? "todo" : "done" } },
      { onSuccess: refresh, onError: () => toast({ title: "Не удалось обновить задачу", tone: "danger" }) }
    );
  }

  return (
    <ViewFrame icon={ListTodo} label="Задачи" query={query}>
      {(project) =>
        !tasksOn ? (
          <PanelBody>
            <EmptyState icon={ListTodo} title="Модуль «Задачи» выключен" description="Включите его в Настройки → Модули." />
          </PanelBody>
        ) : (
          <PanelBody className="[container-type:inline-size]">
            <ProjectTasks
              workspaceId={workspaceId}
              tasks={tasks}
              allTasks={allTasks ?? []}
              milestones={milestones ?? []}
              projects={(workspaceProjects ?? []).some((p) => p.id === project.id) ? (workspaceProjects ?? []) : [project, ...(workspaceProjects ?? [])]}
              loading={isLoading}
              timeOn={isEnabled("time")}
              openTaskId={openTaskId}
              onOpenTask={setOpenTaskId}
              onToggle={toggle}
              onAddTask={() => openPanel(`project:${project.id}`, project.name)}
              onChanged={refresh}
            />
          </PanelBody>
        )
      }
    </ViewFrame>
  );
}

/** Who can see this project (read-only grants) as a panel of its own. */
export function ProjectAccessPanel({ params, api }: PanelComponentProps): React.ReactElement {
  const query = useProjectView(params, api, "Доступ");
  return (
    <ViewFrame icon={ShieldCheck} label="Доступ" query={query}>
      {(project) => (
        <PanelBody className="[container-type:inline-size]">
          <div className="max-w-3xl">
            <ShareGrantSection workspaceId={query.workspaceId} type="project" id={project.id} />
          </div>
        </PanelBody>
      )}
    </ViewFrame>
  );
}
