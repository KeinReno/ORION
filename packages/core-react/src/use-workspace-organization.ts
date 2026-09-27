"use client";

import type {
  AssignWorkspaceSphereInput,
  CreateSphereInput,
  UpdateSphereInput,
  WorkspaceOrganization
} from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * U05 (24-CONNECTED-CORE-BACKLOG.md) — personal spheres + favorites. Not
 * workspace-scoped: one query key per user, like `preferences`/`workspaces`
 * (see the exceptions list in `use-active-workspace.ts`'s sibling U04 note),
 * so it is unaffected by which workspace is currently active.
 */
const QUERY_KEY = ["workspace-organization"] as const;

export function useWorkspaceOrganization() {
  const { api } = useCore();
  return useQuery<WorkspaceOrganization>({
    queryKey: QUERY_KEY,
    queryFn: () => api.getWorkspaceOrganization()
  });
}

function useOrganizationMutation<TInput>(mutationFn: (input: TInput) => Promise<WorkspaceOrganization>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (data) => queryClient.setQueryData(QUERY_KEY, data)
  });
}

export function useCreateSphere() {
  const { api } = useCore();
  return useOrganizationMutation<CreateSphereInput>((input) => api.createSphere(input));
}

export function useUpdateSphere() {
  const { api } = useCore();
  return useOrganizationMutation<{ sphereId: string; input: UpdateSphereInput }>(({ sphereId, input }) =>
    api.updateSphere(sphereId, input)
  );
}

export function useDeleteSphere() {
  const { api } = useCore();
  return useOrganizationMutation<string>((sphereId) => api.deleteSphere(sphereId));
}

export function useAssignWorkspaceSphere() {
  const { api } = useCore();
  return useOrganizationMutation<AssignWorkspaceSphereInput>((input) => api.assignWorkspaceSphere(input));
}

export function useSetWorkspaceFavorite() {
  const { api } = useCore();
  return useOrganizationMutation<{ workspaceId: string; favorite: boolean }>(({ workspaceId, favorite }) =>
    api.setWorkspaceFavorite(workspaceId, favorite)
  );
}
