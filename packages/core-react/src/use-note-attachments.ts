"use client";

import type { NoteAttachment } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

const key = (workspaceId: string | undefined, noteId: string | undefined) =>
  ["note-attachments", workspaceId, noteId] as const;

/**
 * ORION v0.17 "Вложения заметок" — mirrors use-documents.ts. An attachment is
 * a link row joined with a Document, so the mutations invalidate the
 * attachment list itself, and only upload also invalidates `["documents", …]`
 * (it is the one call that creates Documents). Attaching/detaching never
 * touches a Document, hence no invalidation there.
 */
export function useNoteAttachments(workspaceId: string | undefined, noteId: string | undefined) {
  const { api } = useCore();
  return useQuery<NoteAttachment[]>({
    queryKey: key(workspaceId, noteId),
    queryFn: () => api.listNoteAttachments(workspaceId as string, noteId as string),
    enabled: Boolean(workspaceId && noteId)
  });
}

export function useAttachNoteDocument(workspaceId: string | undefined, noteId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => api.attachNoteDocument(workspaceId as string, noteId as string, documentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(workspaceId, noteId) })
  });
}

/** Uploads new files into the shared "Вложения заметок" folder and links them. */
export function useUploadNoteAttachments(workspaceId: string | undefined, noteId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => api.uploadNoteAttachments(workspaceId as string, noteId as string, files),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key(workspaceId, noteId) });
      void queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
    }
  });
}

/** Detaches a file from the note; the Document stays in the "Документы" module. */
export function useDeleteNoteAttachment(workspaceId: string | undefined, noteId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) =>
      api.deleteNoteAttachment(workspaceId as string, noteId as string, attachmentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(workspaceId, noteId) })
  });
}
