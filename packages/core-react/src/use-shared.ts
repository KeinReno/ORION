"use client";

import type { CreateGrantInput, SharedGrantIssued, SharedGrantSummary, SharedObjectView } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/** "Доступно мне" — active grants where I'm the grantee. */
export function useSharedWithMe() {
  const { api } = useCore();
  return useQuery<SharedGrantSummary[]>({
    queryKey: ["shared"],
    queryFn: () => api.listSharedWithMe()
  });
}

/**
 * U09 (27-U09-THREAT-MODEL.md, T2 technical amendment #2): a revoked grant
 * must not keep showing its last successful snapshot on screen. A plain
 * `invalidateQueries` only marks the cache stale and refetches — the refetch
 * immediately gets another 403/404 and, if the component renders `data`
 * before `error`, the stale object flashes right back. `removeQueries`
 * actually deletes the entry from the QueryClient, so a component reading
 * this query sees `undefined`, not the last-known content.
 *
 * Known, accepted limitation (same doc, раздел 4 "Уже скачанные/отрисованные
 * копии"): a copy already rendered on screen or an in-flight request that
 * started before revoke cannot be un-rendered/aborted retroactively — this
 * only stops it from being shown again on the *next* render/query.
 */
export function useSharedObject(grantId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useQuery<SharedObjectView>({
    queryKey: ["shared", grantId],
    queryFn: () => api.getSharedObject(grantId as string),
    enabled: Boolean(grantId),
    // These are principally not "mine" — cache them less confidently than an
    // ordinary workspace resource, per the threat model's explicit guidance.
    staleTime: 0,
    retry: false,
    throwOnError: (error) => {
      if (isAccessError(error)) {
        queryClient.removeQueries({ queryKey: ["shared", grantId] });
      }
      return false;
    }
  });
}

/** Grants issued FROM this workspace — owner's own "кому я дал доступ" list. */
export function useWorkspaceGrants(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<SharedGrantIssued[]>({
    queryKey: ["workspace-grants", workspaceId],
    queryFn: () => api.listGrants(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

export function useCreateGrant(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGrantInput) => api.createGrant(workspaceId as string, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shared"] });
      queryClient.invalidateQueries({ queryKey: ["workspace-grants", workspaceId] });
    }
  });
}

export function useRevokeGrant(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) => api.revokeGrant(workspaceId as string, grantId),
    onSuccess: (_data, grantId) => {
      queryClient.invalidateQueries({ queryKey: ["shared"] });
      queryClient.invalidateQueries({ queryKey: ["workspace-grants", workspaceId] });
      queryClient.removeQueries({ queryKey: ["shared", grantId] });
    }
  });
}

function isAccessError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  return status === 403 || status === 404;
}
