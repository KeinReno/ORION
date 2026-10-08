"use client";

import type { CreateProjectUpdateInput, ProjectUpdate } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/** Manual status reports of one project (UI-05), newest first. */
export function useProjectUpdates(workspaceId: string | undefined, projectId: string | undefined) {
  const { api } = useCore();
  return useQuery<ProjectUpdate[]>({
    queryKey: ["project-updates", workspaceId, projectId],
    queryFn: () => api.listProjectUpdates(workspaceId as string, projectId as string),
    enabled: Boolean(workspaceId && projectId)
  });
}

export function useCreateProjectUpdate(workspaceId: string | undefined, projectId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<ProjectUpdate, Error, CreateProjectUpdateInput>({
    mutationFn: (input) => api.createProjectUpdate(workspaceId as string, projectId as string, input),
    // The newest report also feeds `reportedHealth` on the project itself (header badge, board card).
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project-updates", workspaceId, projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project", workspaceId, projectId] });
      void queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] });
    }
  });
}

export function useDeleteProjectUpdate(workspaceId: string | undefined, projectId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (updateId) => api.deleteProjectUpdate(workspaceId as string, projectId as string, updateId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project-updates", workspaceId, projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project", workspaceId, projectId] });
      void queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] });
    }
  });
}
