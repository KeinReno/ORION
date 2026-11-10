import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateProjectLogEntryInput, CreateProjectRelationInput, ProjectLogEntry, ProjectRelation } from "@orion/shared-types";
import { useCore } from "./provider";

export function useProjectLogEntries(workspaceId: string | undefined, projectId: string | undefined) {
  const { api } = useCore();
  return useQuery<ProjectLogEntry[]>({
    queryKey: ["project-logbook", workspaceId, projectId],
    queryFn: () => api.listProjectLogEntries(workspaceId as string, projectId as string),
    enabled: Boolean(workspaceId && projectId)
  });
}

export function useCreateProjectLogEntry(workspaceId: string | undefined, projectId: string | undefined) {
  const { api } = useCore();
  const client = useQueryClient();
  return useMutation<ProjectLogEntry, Error, CreateProjectLogEntryInput>({
    mutationFn: (input) => api.createProjectLogEntry(workspaceId as string, projectId as string, input),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["project-logbook", workspaceId, projectId] })
  });
}

export function useDeleteProjectLogEntry(workspaceId: string | undefined, projectId: string | undefined) {
  const { api } = useCore();
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.deleteProjectLogEntry(workspaceId as string, projectId as string, id),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["project-logbook", workspaceId, projectId] })
  });
}

export function useProjectRelations(workspaceId: string | undefined, projectId: string | undefined) {
  const { api } = useCore();
  return useQuery<ProjectRelation[]>({
    queryKey: ["project-relations", workspaceId, projectId],
    queryFn: () => api.listProjectRelations(workspaceId as string, projectId as string),
    enabled: Boolean(workspaceId && projectId)
  });
}

export function useCreateProjectRelation(workspaceId: string | undefined, projectId: string | undefined) {
  const { api } = useCore();
  const client = useQueryClient();
  return useMutation<ProjectRelation, Error, CreateProjectRelationInput>({
    mutationFn: (input) => api.createProjectRelation(workspaceId as string, projectId as string, input),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["project-relations", workspaceId] })
  });
}

export function useDeleteProjectRelation(workspaceId: string | undefined, projectId: string | undefined) {
  const { api } = useCore();
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.deleteProjectRelation(workspaceId as string, projectId as string, id),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["project-relations", workspaceId] })
  });
}
