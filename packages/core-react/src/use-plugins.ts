"use client";

import type { WorkspacePluginState } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useWorkspacePlugins(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<WorkspacePluginState[]>({
    queryKey: ["workspace-plugins", workspaceId],
    queryFn: () => api.listWorkspacePlugins(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

export function useSetWorkspacePlugin(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pluginId, enabled }: { pluginId: string; enabled: boolean }) =>
      api.setWorkspacePlugin(workspaceId as string, pluginId, { enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      void queryClient.invalidateQueries({ queryKey: ["workspace-plugins", workspaceId] });
    }
  });
}
