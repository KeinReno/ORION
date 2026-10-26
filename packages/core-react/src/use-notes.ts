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
import { fromReplica, useHybridReplica } from "./use-replica";

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
  const replica = useHybridReplica(workspaceId);
  // Корзина, шаблоны и полнотекстовый поиск требуют узла и в гибридном режиме идут обычным запросом.
  const fromCopy = Boolean(replica) && view !== "trash" && !templates && !(search && search.trim());
  const query = useQuery<Note[]>({
    queryKey: ["notes", workspaceId, view, templates ? "templates" : "notes", search ?? ""],
    queryFn: () => api.listNotes(workspaceId as string, search, view, templates),
    enabled: Boolean(workspaceId) && !fromCopy,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false
  });
  if (replica && fromCopy) {
    const notes = replica.engine
      .notes()
      .filter((note) => !note.isTemplate && (view === "archive" ? note.archivedAt !== null : note.archivedAt === null))
      .sort((a, b) => Number(b.pinnedAt !== null) - Number(a.pinnedAt !== null) || (b.editedAt ?? b.updatedAt).localeCompare(a.editedAt ?? a.updatedAt));
    return fromReplica(query, replica, notes);
  }
  return query;
}

const NOTE_SYNC_FIELDS = ["title", "summary", "body", "tags", "pinnedAt", "archivedAt", "eventAt"] as const;

function onlySyncFields(input: Record<string, unknown>, allowed: readonly string[], ignored: readonly string[] = []): boolean {
  return Object.keys(input).every((key) => input[key] === undefined || allowed.includes(key) || ignored.includes(key));
}

/** Оставляет только то, что реально отличается от копии: редактор шлёт запись целиком, а офлайн-операции нужны точечные. */
function changedOnly(input: Record<string, unknown>, local: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => value !== undefined && key !== "expectedRevision" && JSON.stringify(value) !== JSON.stringify(local[key]))
  );
}

function pick(input: Record<string, unknown>, allowed: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => allowed.includes(key) && value !== undefined));
}

export function useCreateNote(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  const replica = useHybridReplica(workspaceId);
  return useMutation({
    // Гибрид: запись идёт в локальную очередь и без сети — react-query не должен приостанавливать её до появления связи.
    networkMode: replica ? "always" : "online",
    mutationFn: async (input: CreateNoteInput): Promise<Note> => {
      if (replica && onlySyncFields({ ...input }, NOTE_SYNC_FIELDS)) {
        const op = await replica.engine.enqueue({ entity: "note", kind: "create", fields: pick({ ...input }, NOTE_SYNC_FIELDS) });
        void replica.engine.sync();
        return replica.engine.notes().find((note) => note.id === op.entityId) as Note;
      }
      return api.createNote(workspaceId as string, input);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes", workspaceId] })
  });
}

export function useUpdateNote(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  const replica = useHybridReplica(workspaceId);
  return useMutation({
    // Гибрид: запись идёт в локальную очередь и без сети — react-query не должен приостанавливать её до появления связи.
    networkMode: replica ? "always" : "online",
    mutationFn: async ({ noteId, input }: { noteId: string; input: UpdateNoteInput }): Promise<Note> => {
      // Гибрид: правка уходит в очередь (ревизию основы проставляет движок); конфликт показывается явно в баннере.
      const local = replica?.engine.notes().find((note) => note.id === noteId);
      const changed = local ? changedOnly({ ...input }, local as unknown as Record<string, unknown>) : {};
      if (replica && local && onlySyncFields(changed, NOTE_SYNC_FIELDS)) {
        if (Object.keys(changed).length === 0) return local;
        await replica.engine.enqueue({ entity: "note", kind: "patch", entityId: noteId, fields: changed });
        void replica.engine.sync();
        return replica.engine.notes().find((note) => note.id === noteId) as Note;
      }
      return api.updateNote(workspaceId as string, noteId, input);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes", workspaceId] })
  });
}

/** Soft delete — moves the note to the trash. Pair with `useRestoreNote` / `usePurgeNote`. */
export function useDeleteNote(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  const replica = useHybridReplica(workspaceId);
  return useMutation({
    // Гибрид: запись идёт в локальную очередь и без сети — react-query не должен приостанавливать её до появления связи.
    networkMode: replica ? "always" : "online",
    mutationFn: async (noteId: string): Promise<void> => {
      if (replica) {
        await replica.engine.enqueue({ entity: "note", kind: "delete", entityId: noteId });
        void replica.engine.sync();
        return;
      }
      return api.deleteNote(workspaceId as string, noteId);
    },
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
export function useNote(workspaceId: string | undefined, noteId: string | undefined) {
  const { api } = useCore();
  const replica = useHybridReplica(workspaceId);
  const local = replica?.engine.notes().find((note) => note.id === noteId);
  const query = useQuery<Note>({
    queryKey: ["notes", workspaceId, "one", noteId],
    queryFn: () => api.getNote(workspaceId as string, noteId as string),
    enabled: Boolean(workspaceId && noteId) && !local,
    retry: false
  });
  if (replica && local) return fromReplica(query, replica, local);
  return query;
}

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
