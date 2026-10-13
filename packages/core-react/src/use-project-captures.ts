"use client";

import type {
  CreateProjectCaptureInput,
  CreateProjectProblemInput,
  ProjectCapture,
  ProjectCaptureKind,
  UpdateProjectCaptureInput
} from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useProjectCaptures(
  workspaceId: string | undefined,
  projectId: string | undefined,
  kind: ProjectCaptureKind
) {
  const { api } = useCore();
  return useQuery<ProjectCapture[]>({
    queryKey: ["project-captures", workspaceId, projectId, kind],
    queryFn: () => api.listProjectCaptures(workspaceId as string, projectId as string, kind),
    enabled: Boolean(workspaceId && projectId)
  });
}

export function useCreateProjectCapture(
  workspaceId: string | undefined,
  projectId: string | undefined,
  kind: ProjectCaptureKind
) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectCaptureInput | CreateProjectProblemInput) =>
      api.createProjectCapture(workspaceId as string, projectId as string, kind, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-captures", workspaceId, projectId, kind] })
  });
}

export function useUpdateProjectCapture(
  workspaceId: string | undefined,
  projectId: string | undefined,
  kind: ProjectCaptureKind
) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ captureId, input }: { captureId: string; input: UpdateProjectCaptureInput }) =>
      api.updateProjectCapture(workspaceId as string, projectId as string, captureId, kind, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-captures", workspaceId, projectId, kind] })
  });
}

export function useDeleteProjectCapture(
  workspaceId: string | undefined,
  projectId: string | undefined,
  kind: ProjectCaptureKind
) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (captureId: string) => api.deleteProjectCapture(workspaceId as string, projectId as string, captureId, kind),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-captures", workspaceId, projectId, kind] })
  });
}

export function usePromoteProjectCapture(
  workspaceId: string | undefined,
  projectId: string | undefined,
  kind: ProjectCaptureKind
) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (captureId: string) => api.promoteProjectCapture(workspaceId as string, projectId as string, captureId, kind),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project-captures", workspaceId, projectId, kind] });
      void queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["project", workspaceId, projectId] });
    }
  });
}
