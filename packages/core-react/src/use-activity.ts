"use client";

import type { ActivityEntry } from "@orion/shared-types";
import { useQuery } from "@tanstack/react-query";
import { useCore } from "./provider";

/** The merged activity feed (task changes, comments, AI-agent calls), newest first. */
export function useActivity(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<ActivityEntry[]>({
    queryKey: ["activity", workspaceId],
    queryFn: () => api.listActivity(workspaceId as string),
    enabled: Boolean(workspaceId),
    refetchInterval: 30_000
  });
}
