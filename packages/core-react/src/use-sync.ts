"use client";

import type { RestoreInput, SyncRemoteInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

const key = (workspaceId: string | undefined) => ["sync", workspaceId] as const;

/**
 * Sync/backup is owner-only on the server (S02: the remote config holds a
 * decryptable WebDAV password, and restore overwrites the whole workspace).
 * `enabled` takes `isOwner` so a member/lead viewing this panel in the
 * background doesn't fire a doomed-to-403 request every mount — this is
 * client-side hygiene only, not the access control; the server re-checks the
 * role itself on every call regardless of what the client sends.
 */
export function useSyncRemote(workspaceId: string | undefined, isOwner: boolean) {
  const { api } = useCore();
  return useQuery({
    queryKey: [...key(workspaceId), "remote"],
    queryFn: () => api.getSyncRemote(workspaceId as string),
    enabled: Boolean(workspaceId) && isOwner
  });
}

export function useSaveSyncRemote(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SyncRemoteInput) => api.putSyncRemote(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(workspaceId) })
  });
}

export function useTestSyncRemote(workspaceId: string | undefined) {
  const { api } = useCore();
  return useMutation({ mutationFn: () => api.testSyncRemote(workspaceId as string) });
}

export function useBackups(workspaceId: string | undefined, configured: boolean, isOwner: boolean) {
  const { api } = useCore();
  return useQuery({
    queryKey: [...key(workspaceId), "backups"],
    queryFn: () => api.listBackups(workspaceId as string),
    enabled: Boolean(workspaceId && configured) && isOwner
  });
}

export function useRunBackup(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.runBackup(workspaceId as string),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...key(workspaceId), "backups"] })
  });
}

export function useRestoreBackup(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RestoreInput) => api.restoreBackup(workspaceId as string, input),
    onSuccess: (result) => {
      if (result.applied) queryClient.invalidateQueries();
    }
  });
}

export function useDownloadLocalBackup(workspaceId: string | undefined) {
  const { api } = useCore();
  return useMutation({ mutationFn: () => api.downloadLocalBackup(workspaceId as string) });
}

export function usePreviewLocalRestore(workspaceId: string | undefined) {
  const { api } = useCore();
  return useMutation({
    mutationFn: ({ file, fileName }: { file: Blob; fileName: string }) =>
      api.previewLocalRestore(workspaceId as string, file, fileName)
  });
}

export function useApplyLocalRestore(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      file,
      fileName,
      input
    }: {
      file: Blob;
      fileName: string;
      input: { confirmWorkspaceId: string; expectedManifestHash: string };
    }) => api.applyLocalRestore(workspaceId as string, file, fileName, input),
    onSuccess: (result) => {
      if (result.applied) queryClient.invalidateQueries();
    }
  });
}
