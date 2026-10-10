"use client";

import { useProject } from "@orion/core-react";
import { Button, EmptyState, PanelBody, PanelHeader, PanelShell, Skeleton } from "@orion/ui";
import { FolderOpen, GanttChartSquare, TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { describeError } from "../lib/error-message";
import { openPanel } from "../lib/panel-bus";
import type { PanelComponentProps } from "../lib/panel-registry";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { ProjectGantt } from "./projects/gantt";
import { MaterialsTab } from "./ProjectWorkspacePanel";

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
  return (
    <ViewFrame icon={GanttChartSquare} label="План" query={query}>
      {(project) => (
        <PanelBody className="[container-type:inline-size]">
          <ProjectGantt projectId={project.id} />
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
          <MaterialsTab
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
