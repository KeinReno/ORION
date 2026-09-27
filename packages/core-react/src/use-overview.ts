"use client";

import type { MyOverview } from "@orion/shared-types";
import { useQuery } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * U08 — personal cross-workspace overview. Not `workspaceId`-scoped like
 * every other `use*` hook in this file: it aggregates every workspace the
 * caller is already a member of (see OverviewService). `enabled` follows
 * session presence, not an active workspace.
 */
export function useMyOverview(enabled: boolean) {
  const { api } = useCore();
  return useQuery<MyOverview>({
    queryKey: ["my-overview"],
    queryFn: () => api.getMyOverview(),
    enabled
  });
}
