"use client";

import { useRouter } from "next/navigation";
import { openProject, openTask, useObjectOpeningAvailable } from "../../lib/panel-bus";
import { panelWindowUrl } from "../../lib/panel-drop";

/** Detached panels have no dock bus. Use the existing single-object route there. */
export function useDevelopmentNavigation(workspaceId: string) {
  const router = useRouter();
  const dockAvailable = useObjectOpeningAvailable();
  return {
    openProject: (id: string) => dockAvailable ? openProject(id) : router.push(panelWindowUrl(`project:${id}`, workspaceId)),
    openTask: (id: string) => dockAvailable ? openTask(id) : router.push(panelWindowUrl(`task:${id}`, workspaceId))
  };
}
