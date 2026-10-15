"use client";

import type { ProjectCosts } from "@orion/shared-types";
import { useQuery } from "@tanstack/react-query";
import { useCore } from "./provider";

/** Exact income/expense of the operations booked to one project (plugin `finance-project-costs`). */
export function useProjectCosts(workspaceId: string | undefined, projectId: string | undefined) {
  const { api } = useCore();
  return useQuery<ProjectCosts>({
    queryKey: ["finance-project-costs", workspaceId, projectId],
    queryFn: () => api.getProjectCosts(workspaceId as string, projectId as string),
    enabled: Boolean(workspaceId) && Boolean(projectId)
  });
}
