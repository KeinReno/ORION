"use client";

import type { CreateProjectInput, Project, ProjectDetail, UpdateProjectInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * Projects (v0.14): a project is the first-class entity a task's free-form
 * `projectTag` grew into. `archived` mirrors the API's `?archived=true` — the
 * list is either the live board or the archive, never both, because that is
 * how the panel's «Активные / Архив» switch reads it.
 */
export function useProjects(workspaceId: string | undefined, archived = false) {
  const { api } = useCore();
  return useQuery<Project[]>({
    queryKey: ["projects", workspaceId, archived],
    queryFn: () => api.listProjects(workspaceId as string, archived),
    enabled: Boolean(workspaceId)
  });
}

/**
 * One project with its detail payload (full counters + the activity feed).
 * Keyed under its own `["project", …]` prefix: the card grid only needs the
 * summary, so opening a Sheet is what pays for the heavier request.
 */
export function useProject(workspaceId: string | undefined, projectId: string | undefined) {
  const { api } = useCore();
  return useQuery<ProjectDetail>({
    queryKey: ["project", workspaceId, projectId],
    queryFn: () => api.getProject(workspaceId as string, projectId as string),
    enabled: Boolean(workspaceId && projectId)
  });
}

export function useCreateProject(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<Project, Error, CreateProjectInput>({
    mutationFn: (input: CreateProjectInput) => api.createProject(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] })
  });
}

export function useUpdateProject(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<Project, Error, { projectId: string; input: UpdateProjectInput }>({
    mutationFn: ({ projectId, input }: { projectId: string; input: UpdateProjectInput }) =>
      api.updateProject(workspaceId as string, projectId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["project"] });
    }
  });
}

/**
 * Archiving is the delete (see ApiClient.archiveProject) — the row keeps its
 * links to tasks/notes, it just leaves the active list. Un-archiving goes
 * through `useUpdateProject` with `{ archivedAt: null }`.
 */
export function useArchiveProject(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<Project, Error, string>({
    mutationFn: (projectId: string) => api.archiveProject(workspaceId as string, projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["project"] });
    }
  });
}
