"use client";

import type {
  CreateWorkspaceInput,
  CreateWorkspaceInviteInput,
  InviteLookup,
  UpdateWorkspaceInput,
  UpdateWorkspaceMemberRoleInput,
  Workspace,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceMemberSearchResult,
  WorkspaceModuleState,
  WorkspaceTransferPreview,
  ResolveUserByEmailResult
} from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useWorkspaces() {
  const { api } = useCore();
  return useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: () => api.listWorkspaces()
  });
}

/** v0.13 — a second workspace (e.g. a "Демо" space), not general sharing/invites. See useActiveWorkspace for how it becomes selectable. */
export function useCreateWorkspace() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkspaceInput) => api.createWorkspace(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspaces"] })
  });
}

/** ТЗ-05 §5.5: предпросмотр/применение переноса `.orion` — новое пространство, существующее не трогается. */
export function useImportWorkspace() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<
    WorkspaceTransferPreview,
    Error,
    { file: File; dryRun: boolean; name?: string; passphrase?: string; expectedHash?: string }
  >({
    mutationFn: ({ file, ...options }) => api.importWorkspace(file, options),
    onSuccess: (result) => {
      if (result.applied) void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    }
  });
}

/** Файл `.orion` для переноса (только владелец). Возвращает Blob — сохранение выбирает вызывающий. */
export function useExportWorkspace(workspaceId: string | undefined) {
  const { api } = useCore();
  return useMutation({
    mutationFn: (passphrase?: string) => api.exportWorkspace(workspaceId as string, passphrase)
  });
}

export function useUpdateWorkspace(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateWorkspaceInput) => api.updateWorkspace(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspaces"] })
  });
}

/** Deletes the workspace and everything in it (see WorkspacesService.deleteForUser). Owner-only, and the API refuses the user's last remaining workspace. */
export function useDeleteWorkspace() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) => api.deleteWorkspace(workspaceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspaces"] })
  });
}

export function useWorkspaceModules(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<WorkspaceModuleState[]>({
    queryKey: ["workspace-modules", workspaceId],
    queryFn: () => api.listWorkspaceModules(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

export function useSetWorkspaceModule(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ moduleId, enabled }: { moduleId: string; enabled: boolean }) =>
      api.setWorkspaceModule(workspaceId as string, moduleId, { enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      void queryClient.invalidateQueries({ queryKey: ["workspace-modules", workspaceId] });
    }
  });
}

/** Visibility, not availability — see ModulesService.setRestricted. */
export function useSetWorkspaceModuleRestriction(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ moduleId, restricted }: { moduleId: string; restricted: boolean }) =>
      api.setWorkspaceModuleRestriction(workspaceId as string, moduleId, { restricted }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      void queryClient.invalidateQueries({ queryKey: ["workspace-modules", workspaceId] });
    }
  });
}

export function useWorkspaceMembers(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<WorkspaceMember[]>({
    queryKey: ["workspace-members", workspaceId],
    queryFn: () => api.listWorkspaceMembers(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

export function useRemoveWorkspaceMember(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => api.removeWorkspaceMember(workspaceId as string, memberId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["workspace-members", workspaceId] })
  });
}

export function useSetWorkspaceMemberRole(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, input }: { memberId: string; input: UpdateWorkspaceMemberRoleInput }) =>
      api.setWorkspaceMemberRole(workspaceId as string, memberId, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["workspace-members", workspaceId] })
  });
}

export function useWorkspaceInvites(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<WorkspaceInvite[]>({
    queryKey: ["workspace-invites", workspaceId],
    queryFn: () => api.listWorkspaceInvites(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

export function useCreateWorkspaceInvite(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkspaceInviteInput) => api.createWorkspaceInvite(workspaceId as string, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["workspace-invites", workspaceId] })
  });
}

export function useRevokeWorkspaceInvite(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => api.revokeWorkspaceInvite(workspaceId as string, inviteId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["workspace-invites", workspaceId] })
  });
}

/**
 * U09 grant-issue recipient picker (27-U09-THREAT-MODEL.md, раздел 6). No
 * `useQuery` here on purpose — the caller debounces `q` itself and this is
 * typed-search UX, not a cached resource; `enabled` on `q.length >= 2` keeps
 * it from firing on an empty/one-char box (also enforced server-side).
 */
export function useSearchWorkspaceMembers(workspaceId: string | undefined, q: string) {
  const { api } = useCore();
  return useQuery<WorkspaceMemberSearchResult[]>({
    queryKey: ["workspace-members-search", workspaceId, q],
    queryFn: () => api.searchWorkspaceMembers(workspaceId as string, q),
    enabled: Boolean(workspaceId) && q.trim().length >= 2
  });
}

/**
 * R29-05 — exact-email lookup for the grant-issue "по email" flow (someone
 * outside the source workspace, which is the whole point of a grant). Same
 * "caller debounces, no cache reuse across different emails matters much"
 * shape as `useSearchWorkspaceMembers`, but gated on a plausible full email
 * rather than a 2-char minimum, since substring matching isn't offered here.
 */
export function useResolveUserByEmail(email: string, enabled: boolean) {
  const { api } = useCore();
  return useQuery<ResolveUserByEmailResult>({
    queryKey: ["resolve-user-by-email", email],
    queryFn: () => api.resolveUserByEmail(email),
    enabled: enabled && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  });
}

/** Not workspace-scoped — the accept screen looks up a bare invite token. */
export function useInviteLookup(token: string | undefined) {
  const { api } = useCore();
  return useQuery<InviteLookup>({
    queryKey: ["invite-lookup", token],
    queryFn: () => api.lookupInvite(token as string),
    enabled: Boolean(token),
    retry: false
  });
}

export function useAcceptInvite() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api.acceptInvite(token),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["workspaces"] })
  });
}
