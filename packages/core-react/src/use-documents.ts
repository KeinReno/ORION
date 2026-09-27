"use client";

import type {
  BulkDocumentInput,
  CreateFolderInput,
  DocumentItem,
  DocumentVersion,
  DocumentView,
  UpdateDocumentInput
} from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

const key = (workspaceId: string | undefined) => ["documents", workspaceId] as const;
const versionsKey = (workspaceId: string | undefined, id: string | undefined) =>
  [...key(workspaceId), "versions", id] as const;

/**
 * ORION v0.12 "Документы" — mirrors use-notes.ts. `view` picks the slice:
 * `"trash"` lists only soft-deleted rows. The whole workspace comes back as
 * one flat list; the panel builds the folder tree and does search / filter /
 * sort client-side.
 */
export function useDocuments(workspaceId: string | undefined, view: DocumentView = "active") {
  const { api } = useCore();
  return useQuery<DocumentItem[]>({
    queryKey: [...key(workspaceId), view],
    queryFn: () => api.listDocuments(workspaceId as string, view),
    enabled: Boolean(workspaceId)
  });
}

export function useCreateFolder(workspaceId: string | undefined) {
  const { api } = useCore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFolderInput) => api.createFolder(workspaceId as string, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(workspaceId) })
  });
}

export function useUploadDocuments(workspaceId: string | undefined) {
  const { api } = useCore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ parentId, files }: { parentId: string | null; files: File[] }) =>
      api.uploadDocuments(workspaceId as string, parentId, files),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(workspaceId) })
  });
}

export function useRenameOrMoveDocument(workspaceId: string | undefined) {
  const { api } = useCore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateDocumentInput }) =>
      api.renameOrMoveDocument(workspaceId as string, id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(workspaceId) })
  });
}

/** Soft delete — moves the node to the trash. Pair with `useRestoreDocument` / `usePurgeDocument`. */
export function useDeleteDocument(workspaceId: string | undefined) {
  const { api } = useCore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteDocument(workspaceId as string, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(workspaceId) })
  });
}

export function useRestoreDocument(workspaceId: string | undefined) {
  const { api } = useCore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.restoreDocument(workspaceId as string, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(workspaceId) })
  });
}

/** Irreversible hard delete from the trash. */
export function usePurgeDocument(workspaceId: string | undefined) {
  const { api } = useCore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.purgeDocument(workspaceId as string, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(workspaceId) })
  });
}

export function useBulkDocuments(workspaceId: string | undefined) {
  const { api } = useCore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkDocumentInput) => api.bulkDocuments(workspaceId as string, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(workspaceId) })
  });
}

/**
 * The raw bytes of one file, fetched with auth. The caller turns the `Blob`
 * into an object URL for `<FilePreview>` / download and revokes it on unmount.
 * Cached hard (`staleTime: Infinity`) — a file's content at a given id doesn't
 * change under us.
 */
export function useDocumentBlob(workspaceId: string | undefined, id: string | undefined) {
  const { api } = useCore();
  return useQuery<Blob>({
    queryKey: ["document-blob", workspaceId, id],
    queryFn: () => api.getDocumentBlob(workspaceId as string, id as string),
    enabled: Boolean(workspaceId && id),
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000
  });
}

/** Version history for a file, newest first. */
export function useDocumentVersions(workspaceId: string | undefined, id: string | undefined) {
  const { api } = useCore();
  return useQuery<DocumentVersion[]>({
    queryKey: versionsKey(workspaceId, id),
    queryFn: () => api.listDocumentVersions(workspaceId as string, id as string),
    enabled: Boolean(workspaceId && id)
  });
}

/**
 * Overwrites a file's content. Also invalidates the cached blob — unlike the
 * rest of this module, `useDocumentBlob` above assumes a doc id's content
 * never changes (`staleTime: Infinity`), an assumption this mutation (and
 * `useRestoreDocumentVersion`) breaks.
 */
export function useReplaceDocumentContent(workspaceId: string | undefined) {
  const { api } = useCore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => api.replaceDocumentContent(workspaceId as string, id, file),
    onSuccess: (_doc, { id }) => {
      qc.invalidateQueries({ queryKey: key(workspaceId) });
      qc.invalidateQueries({ queryKey: ["document-blob", workspaceId, id] });
      qc.invalidateQueries({ queryKey: versionsKey(workspaceId, id) });
    }
  });
}

/** Rolls a file back to a past version; the current content is archived as a new version first. */
export function useRestoreDocumentVersion(workspaceId: string | undefined) {
  const { api } = useCore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, versionId }: { id: string; versionId: string }) =>
      api.restoreDocumentVersion(workspaceId as string, id, versionId),
    onSuccess: (_doc, { id }) => {
      qc.invalidateQueries({ queryKey: key(workspaceId) });
      qc.invalidateQueries({ queryKey: ["document-blob", workspaceId, id] });
      qc.invalidateQueries({ queryKey: versionsKey(workspaceId, id) });
    }
  });
}
