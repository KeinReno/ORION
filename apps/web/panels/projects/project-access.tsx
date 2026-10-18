"use client";

import { PanelSection } from "@orion/ui";
import { ShareGrantSection } from "../../components/share-grant-section";
import { useActiveWorkspace } from "../../lib/use-active-workspace";

/**
 * «Доступ» of a project — the tab and its detached panel. The grant widget is drawn for the
 * workspace owner only and is built for a side pane, so on its own a member saw an empty tab and
 * the owner a caption with its button a screen away. Here it gets a heading, a reading width and a
 * line saying what a grant is, or why there is nothing to change.
 */
export function ProjectAccessSection({ workspaceId, projectId }: { workspaceId: string | undefined; projectId: string }): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const isOwner = Boolean(workspace) && workspace?.id === workspaceId && workspace?.role === "owner";
  return (
    <PanelSection title="Кто видит проект">
      <div className="flex max-w-2xl flex-col gap-3">
        <p className="text-label text-muted-foreground">
          {isOwner
            ? "Участники пространства уже видят проект. Здесь можно дать отдельному человеку доступ на чтение к названию, описанию, статусу и срокам проекта и отозвать его в любой момент."
            : "Участники пространства уже видят проект. Открыть его кому-то ещё может только владелец пространства."}
        </p>
        <ShareGrantSection workspaceId={workspaceId} type="project" id={projectId} />
      </div>
    </PanelSection>
  );
}
