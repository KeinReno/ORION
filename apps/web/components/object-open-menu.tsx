"use client";

import type { ViewRef } from "@orion/shared-types";
import { DropdownMenu, IconButton } from "@orion/ui";
import { MoreHorizontal } from "lucide-react";
import { objectViewPanel } from "../lib/object-view";
import { openObject, useObjectOpeningAvailable } from "../lib/panel-bus";

/** Same explicit opening actions at every object entry point; never nested in its primary button. */
export function ObjectOpenMenu({ view, title, beforeOpen }: { view: ViewRef; title: string; beforeOpen?: () => void }): React.ReactElement | null {
  const available = useObjectOpeningAvailable();
  if (!available || !objectViewPanel(view, view.object.workspaceId)) return null;
  return <DropdownMenu align="end" trigger={({ toggle }) => <IconButton label={`Открытие: ${title || "Без названия"}`} size="sm" onClick={toggle}><MoreHorizontal className="h-3.5 w-3.5" /></IconButton>}
    items={[
      { label: "Открыть в новой вкладке", onSelect: () => { beforeOpen?.(); openObject(view, "tab", title); } },
      { label: "Открыть рядом", onSelect: () => { beforeOpen?.(); openObject(view, "beside", title); } },
      { label: "Открыть в отдельном окне", onSelect: () => { beforeOpen?.(); openObject(view, "window", title); } }
    ]} />;
}
