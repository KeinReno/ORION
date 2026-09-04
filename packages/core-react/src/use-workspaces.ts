"use client";

import type { Workspace } from "@orion/shared-types";
import { useQuery } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useWorkspaces() {
  const { api } = useCore();
  return useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: () => api.listWorkspaces()
  });
}
