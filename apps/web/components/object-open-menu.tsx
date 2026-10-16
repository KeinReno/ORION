"use client";

import type { ViewRef } from "@orion/shared-types";
import { useDocuments } from "@orion/core-react";
import { ApiError } from "@orion/core";
import { DropdownMenu, IconButton } from "@orion/ui";
import { MoreHorizontal } from "lucide-react";
import { objectViewPanel } from "../lib/object-view";
import { openObject, useObjectOpeningAvailable } from "../lib/panel-bus";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";

/** Same explicit opening actions at every object entry point; never nested in its primary button. */
export function ObjectOpenMenu({ view, title, beforeOpen }: { view: ViewRef; title: string; beforeOpen?: () => void }): React.ReactElement | null {
  const available = useObjectOpeningAvailable();
  const { workspace } = useActiveWorkspace();
  const { isEnabled } = useEnabledModules();
  const documents = useDocuments(available && view.object.entityType === "document" && view.object.workspaceId === workspace?.id && isEnabled("documents") ? workspace.id : undefined);
  if (!available || !objectViewPanel(view, workspace?.id ?? null)) return null;
  if (view.object.entityType === "document" && documents.error instanceof ApiError && [401, 403, 404].includes(documents.error.status)) return null;
  // Search/link addresses also include folders. Only an authorized active file has this standalone view.
  if (view.object.entityType === "document" && !documents.data?.some(doc => doc.id === view.object.entityId && doc.kind === "file" && !doc.deletedAt)) return null;
  return <DropdownMenu align="end" trigger={({ toggle }) => <IconButton label={`Открытие: ${title || "Без названия"}`} size="sm" onClick={toggle}><MoreHorizontal className="h-3.5 w-3.5" /></IconButton>}
    items={[
      { label: "Открыть в новой вкладке", onSelect: () => { beforeOpen?.(); openObject(view, "tab", title); } },
      { label: "Открыть рядом", onSelect: () => { beforeOpen?.(); openObject(view, "beside", title); } },
      { label: "Открыть в отдельном окне", onSelect: () => { beforeOpen?.(); openObject(view, "window", title); } }
    ]} />;
}
