"use client";

import type {
  CreateMilestoneInput,
  Milestone,
  MilestoneCascadeImpact,
  MilestoneReschedulePreviewInput,
  UpdateMilestoneInput
} from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * Вехи / план проекта (v0.27) — second level of the Gantt. `projectId`
 * scopes the list to one project's plan; omit it for every milestone in the
 * workspace (not currently used by the panel, but the API supports it the
 * same way `useTasks` supports an unscoped list).
 */
export function useMilestones(workspaceId: string | undefined, projectId?: string) {
  const { api } = useCore();
  return useQuery<Milestone[]>({
    queryKey: ["milestones", workspaceId, projectId ?? ""],
    queryFn: () => api.listMilestones(workspaceId as string, projectId),
    enabled: Boolean(workspaceId)
  });
}

function useInvalidateMilestones(workspaceId: string | undefined): () => void {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ["milestones", workspaceId] });
}

export function useCreateMilestone(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateMilestones(workspaceId);
  return useMutation<Milestone, Error, CreateMilestoneInput>({
    mutationFn: (input: CreateMilestoneInput) => api.createMilestone(workspaceId as string, input),
    onSuccess: invalidate
  });
}

/**
 * A date/dependency edit can cascade-reschedule *other* milestones
 * server-side (see MilestonesService.cascadeReschedule) — the mutation
 * always invalidates the whole list rather than patching just the one
 * milestone in cache, so a drag-resize picks up any pushed dependents too.
 */
export function useUpdateMilestone(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateMilestones(workspaceId);
  return useMutation<Milestone, Error, { milestoneId: string; input: UpdateMilestoneInput }>({
    mutationFn: ({ milestoneId, input }: { milestoneId: string; input: UpdateMilestoneInput }) =>
      api.updateMilestone(workspaceId as string, milestoneId, input),
    onSuccess: invalidate
  });
}

/**
 * S14a — cascade preview. A mutation (not a query) because it's parameterised
 * by the hypothetical dates a drag/edit is proposing, not by workspace state
 * alone — the Gantt calls `mutateAsync` on pointerup/save, before deciding
 * whether to show a confirm step or apply straight away.
 */
export function useMilestoneReschedulePreview(workspaceId: string | undefined) {
  const { api } = useCore();
  return useMutation<MilestoneCascadeImpact[], Error, { milestoneId: string; input: MilestoneReschedulePreviewInput }>({
    mutationFn: ({ milestoneId, input }) => api.previewMilestoneReschedule(workspaceId as string, milestoneId, input)
  });
}

export function useDeleteMilestone(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateMilestones(workspaceId);
  return useMutation<void, Error, string>({
    mutationFn: (milestoneId: string) => api.deleteMilestone(workspaceId as string, milestoneId),
    onSuccess: invalidate
  });
}
