"use client";

import type { Capture, CreateCaptureInput, ListCapturesQuery, UpdateCaptureInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/** Cache prefix shared by every capture list of a workspace, so one invalidation refreshes all hosts. */
const key = (workspaceId: string | undefined) => ["captures", workspaceId] as const;

export function useCaptures(workspaceId: string | undefined, query: ListCapturesQuery = {}) {
  const { api } = useCore();
  return useQuery<Capture[]>({
    queryKey: [...key(workspaceId), query.anchorType ?? null, query.anchorId ?? null, query.kind ?? null, query.status ?? null],
    queryFn: () => api.listCaptures(workspaceId as string, query),
    enabled: Boolean(workspaceId)
  });
}

export function useCreateCapture(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCaptureInput) => api.createCapture(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(workspaceId) })
  });
}

export function useUpdateCapture(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ captureId, input }: { captureId: string; input: UpdateCaptureInput }) =>
      api.updateCapture(workspaceId as string, captureId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(workspaceId) })
  });
}

export function useDeleteCapture(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (captureId: string) => api.deleteCapture(workspaceId as string, captureId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(workspaceId) })
  });
}

export function usePromoteCapture(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (captureId: string) => api.promoteCapture(workspaceId as string, captureId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId] });
    }
  });
}
