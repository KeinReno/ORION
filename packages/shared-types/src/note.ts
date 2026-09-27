import { z } from "zod";

export const noteSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string().nullable(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  /// Non-null = pinned (the value is "pinned since", for a stable sort).
  pinnedAt: z.string().nullable(),
  /// Optional date that puts the note on the calendar, next to tasks.
  eventAt: z.string().nullable(),
  /// "Content last changed" — unlike `updatedAt`, a pin/unpin does not move
  /// it. Null only for notes created before v0.8. Use it for the
  /// "изменённые" sort; fall back to `updatedAt` when null.
  editedAt: z.string().nullable(),
  /// Non-null = the note is in the trash (soft-deleted, restorable).
  deletedAt: z.string().nullable(),
  /// Non-null = archived (out of the normal list, not trash — never
  /// auto-purged, still editable). "archived since".
  archivedAt: z.string().nullable(),
  /// `YYYY-MM-DD` when this note is the "daily note" for that date (one per
  /// workspace), else null. Set by `POST .../notes/daily`, not editable.
  dailyOn: z.string().nullable(),
  /// True = a reusable template, kept out of the normal list and offered by
  /// "Новая из шаблона".
  isTemplate: z.boolean(),
  /// Optimistic-concurrency counter (CAS), S11 — bumped by exactly 1 on
  /// every successful content write. The client echoes it back as
  /// `expectedRevision` on the next `update`; a mismatch is a 409
  /// (`NoteConflictError`-shaped body), meaning another client saved first.
  revision: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Note = z.infer<typeof noteSchema>;

/// Lightweight `{ id, title }` used to feed the `[[wiki link]]` autocomplete
/// without shipping every note body — `GET .../notes/titles`.
/// `snippet` — start of the note's own body, collapsed/truncated — feeds the
/// `[[wiki link]]` hover preview. Unlike `NoteBacklink.snippet` (excerpt of
/// the *linking* note around its first `[[`), this is an excerpt of *this*
/// note's own content.
export const noteTitleRefSchema = z.object({ id: z.string(), title: z.string(), snippet: z.string() });
export type NoteTitleRef = z.infer<typeof noteTitleRefSchema>;

/// One note that links to the note being viewed — `GET .../notes/:id/backlinks`.
export const noteBacklinkSchema = z.object({
  id: z.string(),
  title: z.string(),
  /// A short plain-text excerpt of the linking note around its first `[[`.
  snippet: z.string()
});
export type NoteBacklink = z.infer<typeof noteBacklinkSchema>;

/// Row in the version-history list — no body, so the list stays light.
export const noteRevisionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  /// When the snapshot was taken (= when the note last changed before it).
  createdAt: z.string()
});
export type NoteRevisionSummary = z.infer<typeof noteRevisionSummarySchema>;

/// One full past snapshot — `GET .../notes/:id/revisions/:revisionId`.
export const noteRevisionSchema = noteRevisionSummarySchema.extend({
  noteId: z.string(),
  body: z.string(),
  tags: z.array(z.string())
});
export type NoteRevision = z.infer<typeof noteRevisionSchema>;

/// Which slice of the list the notes panel is showing, passed as `?view=`:
/// `active` = live, non-archived; `archive` = archived (newest-archived
/// first); `trash` = soft-deleted (newest-deleted first).
export const noteViewSchema = z.enum(["active", "archive", "trash"]);
export type NoteView = z.infer<typeof noteViewSchema>;

const noteTagSchema = z.string().min(1).max(40);

/// Rename one tag to another across every note in the workspace — a rename
/// when `to` is new, a merge when it already exists. `POST .../notes/tags/rename`.
export const renameNoteTagInputSchema = z.object({ from: noteTagSchema, to: noteTagSchema });
export type RenameNoteTagInput = z.infer<typeof renameNoteTagInputSchema>;

/**
 * One file attached to a note (`note_attachments`) — the link row joined with
 * the `Document` it points at. The bytes themselves belong to the "Документы"
 * module: this schema carries only what the list needs to render, so detaching
 * a file never has to touch its blob (see `NoteAttachmentsService.remove`).
 */
export const noteAttachmentSchema = z.object({
  id: z.string(),
  noteId: z.string(),
  documentId: z.string(),
  name: z.string(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  createdAt: z.string()
});
export type NoteAttachment = z.infer<typeof noteAttachmentSchema>;

/// Attach an already uploaded document to a note — `POST .../notes/:id/attachments`.
export const attachNoteDocumentInputSchema = z.object({ documentId: z.string().min(1, "Документ обязателен") });
export type AttachNoteDocumentInput = z.infer<typeof attachNoteDocumentInputSchema>;

export const createNoteInputSchema = z.object({
  title: z.string().min(1, "Заголовок обязателен").max(200),
  body: z.string().max(20_000).default(""),
  tags: z.array(noteTagSchema).max(20).default([]),
  eventAt: z.string().datetime().nullable().optional(),
  isTemplate: z.boolean().optional(),
  projectId: z.string().nullable().optional()
});
export type CreateNoteInput = z.infer<typeof createNoteInputSchema>;

export const updateNoteInputSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(20_000).optional(),
  tags: z.array(noteTagSchema).max(20).optional(),
  pinnedAt: z.string().datetime().nullable().optional(),
  eventAt: z.string().datetime().nullable().optional(),
  archivedAt: z.string().datetime().nullable().optional(),
  isTemplate: z.boolean().optional(),
  projectId: z.string().nullable().optional(),
  /// CAS token (S11) — the `revision` this edit was based on. Content-touching
  /// autosave/manual-save calls should always send it; omitted only by
  /// non-content PATCHes (pin/archive toggles) that don't participate in the
  /// editor's conflict detection. A mismatch on the server is rejected with
  /// 409, not applied.
  expectedRevision: z.number().int().optional()
});
export type UpdateNoteInput = z.infer<typeof updateNoteInputSchema>;

/// R18-02: restoring a historical revision changes title/body/tags exactly
/// like a content `update`, so it participates in the same CAS as `update` —
/// an editor with a stale open revision that saves right after a restore
/// must get a 409, not silently clobber the just-restored content. Optional
/// for the same reason as `updateNoteInputSchema.expectedRevision`: the
/// server still closes the CAS gap for a caller that omits it by falling
/// back to the row it just read inside the same transaction (see
/// `NotesService.restoreRevision`) — this only widens the protection, it
/// never narrows it, so no client needs to change to stay correct.
export const restoreNoteRevisionInputSchema = z.object({
  expectedRevision: z.number().int().optional()
});
export type RestoreNoteRevisionInput = z.infer<typeof restoreNoteRevisionInputSchema>;

/// Body of the 409 thrown by `PATCH .../notes/:id` when `expectedRevision`
/// doesn't match the current row — lets the client show a real conflict UI
/// (not just a generic error toast) and offer "reload the latest version".
export const noteConflictSchema = z.object({
  code: z.literal("note_revision_conflict"),
  currentRevision: z.number().int(),
  current: noteSchema
});
export type NoteConflict = z.infer<typeof noteConflictSchema>;
