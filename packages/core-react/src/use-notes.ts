"use client";

import type { CreateNoteInput, Note, UpdateNoteInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useNotes(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<Note[]>({
    queryKey: ["notes", workspaceId],
    queryFn: () => api.listNotes(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

export function useCreateNote(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateNoteInput) => api.createNote(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes", workspaceId] })
  });
}

export function useUpdateNote(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, input }: { noteId: string; input: UpdateNoteInput }) =>
      api.updateNote(workspaceId as string, noteId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes", workspaceId] })
  });
}

export function useDeleteNote(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => api.deleteNote(workspaceId as string, noteId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes", workspaceId] })
  });
}
