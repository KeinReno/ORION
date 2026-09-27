"use client";

import type {
  CreateNoteInput,
  Note,
  NoteBacklink,
  NoteRevision,
  NoteRevisionSummary,
  NoteTitleRef,
  NoteView,
  UpdateNoteInput
} from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * `search` (optional) switches to the server's full-text query instead of
 * the plain list (see NotesService.list) — pass a debounced value, since
 * each distinct string is its own cached query and fires its own request.
 * `view` picks the slice: `"trash"` lists only soft-deleted notes.
 */
export function useNotes(
  workspaceId: string | undefined,
  search?: string,
  view: NoteView = "active",
  templates = false
) {
  const { api } = useCore();
  return useQuery<Note[]>({
    queryKey: ["notes", workspaceId, view, templates ? "templates" : "notes", search ?? ""],
    queryFn: () => api.listNotes(workspaceId as string, search, view, templates),
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

/** Soft delete — moves the note to the trash. Pair with `useRestoreNote` / `usePurgeNote`. */
export function useDeleteNote(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => api.deleteNote(workspaceId as string, noteId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes", workspaceId] })
  });
}

export function useRestoreNote(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => api.restoreNote(workspaceId as string, noteId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes", workspaceId] })
  });
}

/** Irreversible hard delete from the trash. */
export function usePurgeNote(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => api.purgeNote(workspaceId as string, noteId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes", workspaceId] })
  });
}

/**
 * `{ id, title }` of every live note — for the `[[wiki link]]` autocomplete.
 * Shares the `["notes", workspaceId]` key prefix, so any note mutation
 * refetches it and the suggestions stay current.
 */
export function useNoteTitles(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<NoteTitleRef[]>({
    queryKey: ["notes", workspaceId, "titles"],
    queryFn: () => api.listNoteTitles(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

/** Notes that link to `noteId` via a body `[[wiki link]]`. */
export function useNoteBacklinks(workspaceId: string | undefined, noteId: string | undefined) {
  const { api } = useCore();
  return useQuery<NoteBacklink[]>({
    queryKey: ["notes", workspaceId, "backlinks", noteId],
    queryFn: () => api.noteBacklinks(workspaceId as string, noteId as string),
    enabled: Boolean(workspaceId && noteId)
  });
}

/** Open (or create) today's daily note. */
export function useOpenDailyNote(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.openDailyNote(workspaceId as string),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes", workspaceId] })
  });
}

/** Version history for a note, newest first (summaries — no bodies). */
export function useNoteRevisions(workspaceId: string | undefined, noteId: string | undefined) {
  const { api } = useCore();
  return useQuery<NoteRevisionSummary[]>({
    queryKey: ["notes", workspaceId, "revisions", noteId],
    queryFn: () => api.listNoteRevisions(workspaceId as string, noteId as string),
    enabled: Boolean(workspaceId && noteId)
  });
}

/** One full past snapshot (with body) — fetched when a revision is opened for diffing. */
export function useNoteRevision(
  workspaceId: string | undefined,
  noteId: string | undefined,
  revisionId: string | undefined
) {
  const { api } = useCore();
  return useQuery<NoteRevision>({
    queryKey: ["notes", workspaceId, "revisions", noteId, revisionId],
    queryFn: () => api.getNoteRevision(workspaceId as string, noteId as string, revisionId as string),
    enabled: Boolean(workspaceId && noteId && revisionId)
  });
}

/**
 * Roll the note back to a past snapshot. Awaits the refetch before
 * resolving, so a caller can remount its editor on fresh data.
 */
export function useRestoreNoteRevision(workspaceId: string | undefined, noteId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (revisionId: string) => api.restoreNoteRevision(workspaceId as string, noteId as string, revisionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes", workspaceId] })
  });
}

/** Rename/merge a tag across the whole workspace. */
export function useRenameNoteTag(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => api.renameNoteTag(workspaceId as string, from, to),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes", workspaceId] })
  });
}

/** Remove a tag from every note in the workspace. */
export function useDeleteNoteTag(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tag: string) => api.deleteNoteTag(workspaceId as string, tag),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes", workspaceId] })
  });
}
