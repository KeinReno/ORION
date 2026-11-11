import { z } from "zod";

export const noteSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string().nullable(),
  stackId: z.string().nullable().optional(),
  stackTitle: z.string().nullable().optional(),
  stackOrder: z.number().int().optional(),
  title: z.string(),
  /// Short stable id within the workspace — shown as "N-<number>". Null only for a row that
  /// predates the trigger and was not backfilled (should not occur after the migration).
  number: z.number().int().nullable(),
  /// Optional short description ("о чём заметка"); empty string = none, and the
  /// list falls back to a plain-text excerpt of `body`.
  summary: z.string(),
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
  /// G21 (ADR-0021): личная заметка внутри общего пространства — её видит только автор. Ответ сервера всегда содержит поле.
  isPrivate: z.boolean().optional(),
  /// Optimistic-concurrency counter (CAS), S11 — bumped by exactly 1 on
  /// every successful content write. The client echoes it back as
  /// `expectedRevision` on the next `update`; a mismatch is a 409
  /// (`NoteConflictError`-shaped body), meaning another client saved first.
  revision: z.number().int(),
  /** AI Bridge token names (ADR-0007) of who created / last edited the note via `/ai/v1`; null = a person. */
  createdByAgent: z.string().nullable().optional(),
  editedByAgent: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Note = z.infer<typeof noteSchema>;

/** "N-104" — how a note's short id is written everywhere (list, editor, search). */
export function noteNumberLabel(number: number | null): string | null {
  return number === null ? null : `N-${number}`;
}

/**
 * A search box entry that is really a note id: "N-104", "n104", "N 104" or a
 * bare "104". Returns the number, or null for ordinary text. A bare number is
 * accepted on purpose — people type the digits — and still searches the text
 * too (the caller ORs the two), so a note that merely contains "2026" is found.
 */
export function parseNoteNumber(query: string): number | null {
  const match = /^\s*(?:n[-\s]?)?(\d{1,9})\s*$/i.exec(query);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

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
  createdAt: z.string(),
  /// 07 (Заметки 2.0): id версии, из которой восстановлено содержимое этой
  /// записи истории. null = обычный снимок (не восстановление).
  restoredFrom: z.string().nullable()
});
export type NoteRevisionSummary = z.infer<typeof noteRevisionSummarySchema>;

/// One full past snapshot — `GET .../notes/:id/revisions/:revisionId`.
export const noteRevisionSchema = noteRevisionSummarySchema.extend({
  noteId: z.string(),
  summary: z.string(),
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

export const createNoteStackInputSchema = z.object({
  title: z.string().trim().min(1, "Название стопки обязательно").max(80),
  noteIds: z.array(z.string().min(1)).min(2).max(100),
  /// 07 (Заметки 2.0): вложенные стопки сознательно не поддерживаются. Поле
  /// принимается, чтобы отказ был явным 400 с текстом, а не молчаливым
  /// игнорированием лишнего ключа.
  parentStackId: z.string().min(1).optional()
}).refine((input) => new Set(input.noteIds).size === input.noteIds.length, { message: "Заметка указана несколько раз", path: ["noteIds"] });
export type CreateNoteStackInput = z.infer<typeof createNoteStackInputSchema>;

export const noteStackSchema = z.object({ id: z.string(), title: z.string(), noteIds: z.array(z.string()) });
export type NoteStack = z.infer<typeof noteStackSchema>;
export const reorderNoteStackInputSchema = z.object({
  noteIds: z.array(z.string().min(1)).min(2).max(100)
}).refine((input) => new Set(input.noteIds).size === input.noteIds.length, {
  message: "Заметка указана несколько раз",
  path: ["noteIds"]
});
export type ReorderNoteStackInput = z.infer<typeof reorderNoteStackInputSchema>;
export const moveNotesToStackInputSchema = z.object({
  noteIds: z.array(z.string().min(1)).min(1).max(100)
}).refine((input) => new Set(input.noteIds).size === input.noteIds.length, { message: "Заметка указана несколько раз", path: ["noteIds"] });
export type MoveNotesToStackInput = z.infer<typeof moveNotesToStackInputSchema>;

/// Attach an already uploaded document to a note — `POST .../notes/:id/attachments`.
export const attachNoteDocumentInputSchema = z.object({ documentId: z.string().min(1, "Документ обязателен") });
export type AttachNoteDocumentInput = z.infer<typeof attachNoteDocumentInputSchema>;

export const createNoteInputSchema = z.object({
  title: z.string().min(1, "Заголовок обязателен").max(200),
  summary: z.string().max(300).optional(),
  body: z.string().max(20_000).default(""),
  tags: z.array(noteTagSchema).max(20).default([]),
  eventAt: z.string().datetime().nullable().optional(),
  isTemplate: z.boolean().optional(),
  projectId: z.string().nullable().optional(),
  /** Личная заметка: видна только автору (ADR-0021). */
  isPrivate: z.boolean().optional()
});
export type CreateNoteInput = z.infer<typeof createNoteInputSchema>;

export const updateNoteInputSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  summary: z.string().max(300).optional(),
  body: z.string().max(20_000).optional(),
  tags: z.array(noteTagSchema).max(20).optional(),
  pinnedAt: z.string().datetime().nullable().optional(),
  eventAt: z.string().datetime().nullable().optional(),
  archivedAt: z.string().datetime().nullable().optional(),
  isTemplate: z.boolean().optional(),
  projectId: z.string().nullable().optional(),
  /** Сделать заметку личной (`true`) или снова общей (`false`); меняет только автор — чужую личную заметку не видно вовсе. */
  isPrivate: z.boolean().optional(),
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

// --- 07 (Заметки 2.0): ссылки, поиск, связанные заметки, стопки ----------

/// Одна wiki-ссылка заметки в ответе GET .../notes/:id/links.
export const noteLinkEntrySchema = z.object({
  id: z.string(),
  /// "outgoing" — ссылка из этой заметки; "incoming" — обратная (backlink).
  direction: z.enum(["outgoing", "incoming"]),
  /// Для outgoing — текст внутри [[...]] как написан; для incoming — заголовок источника.
  title: z.string(),
  /// Заметка на другом конце, если ссылка разрешилась; null — цель не найдена.
  noteId: z.string().nullable(),
  /// true = битая ссылка: цель удалена, переименована или ещё не создана.
  /// Запись при этом не удаляется — её видно в разборе битых ссылок.
  broken: z.boolean()
});
export type NoteLinkEntry = z.infer<typeof noteLinkEntrySchema>;

export const noteLinksSchema = z.object({
  outgoing: z.array(noteLinkEntrySchema),
  incoming: z.array(noteLinkEntrySchema)
});
export type NoteLinks = z.infer<typeof noteLinksSchema>;

/// Битая ссылка в масштабе пространства (GET .../notes/links/broken).
export const brokenNoteLinkSchema = z.object({
  id: z.string(),
  sourceNoteId: z.string(),
  sourceTitle: z.string(),
  /// Текст внутри [[...]], который никуда не ведёт.
  targetTitle: z.string(),
  createdAt: z.string()
});
export type BrokenNoteLink = z.infer<typeof brokenNoteLinkSchema>;

/// Вхождение поискового запроса в теле заметки — для подсветки на клиенте.
export const noteSearchMatchSchema = z.object({
  /// Смещение в UTF-16 единицах (индексы JavaScript-строки), включительно.
  start: z.number().int(),
  /// Конец вхождения, исключительно.
  end: z.number().int(),
  /// Номер строки, 1-based.
  line: z.number().int(),
  /// Текст строки с вхождением.
  text: z.string()
});
export type NoteSearchMatch = z.infer<typeof noteSearchMatchSchema>;

export const noteSearchResultSchema = z.object({
  query: z.string(),
  total: z.number().int(),
  matches: z.array(noteSearchMatchSchema),
  /// true = вхождений больше, чем вернулось в matches.
  truncated: z.boolean()
});
export type NoteSearchResult = z.infer<typeof noteSearchResultSchema>;

/// Почему заметка попала в «связанные»: wiki-ссылка, обратная ссылка,
/// общая связь EntityLink или общий проект.
export const noteRelatedReasonSchema = z.enum(["wiki-link", "backlink", "entity-link", "project"]);
export type NoteRelatedReason = z.infer<typeof noteRelatedReasonSchema>;

export const noteRelatedSchema = z.object({
  noteId: z.string(),
  title: z.string(),
  /// Начало тела связанной заметки — для превью в списке.
  snippet: z.string(),
  reasons: z.array(noteRelatedReasonSchema)
});
export type NoteRelated = z.infer<typeof noteRelatedSchema>;

/// Строка построчного diff'а между версиями (07, 7.1).
export const noteDiffLineSchema = z.object({
  type: z.enum(["equal", "added", "removed"]),
  text: z.string(),
  oldLine: z.number().int().nullable(),
  newLine: z.number().int().nullable()
});
export type NoteDiffLineDto = z.infer<typeof noteDiffLineSchema>;

export const noteRevisionDiffSchema = z.object({
  /// С какой версией сравниваем (всегда заполнена).
  fromRevisionId: z.string(),
  /// С чем сравниваем; null = с текущим содержимым заметки.
  toRevisionId: z.string().nullable(),
  fromTitle: z.string(),
  toTitle: z.string(),
  lines: z.array(noteDiffLineSchema),
  added: z.number().int(),
  removed: z.number().int()
});
export type NoteRevisionDiff = z.infer<typeof noteRevisionDiffSchema>;

/// Состояние стопки для одного участника (per-user): свёрнута ли и как
/// упорядочена среди других стопок. Хранится отдельно от самих заметок.
export const noteStackStateSchema = z.object({
  stackId: z.string(),
  collapsed: z.boolean(),
  sortOrder: z.number().int(),
  /// Заголовок стопки — чтобы клиент мог нарисовать список стопок без
  /// отдельного запроса заметок.
  title: z.string()
});
export type NoteStackState = z.infer<typeof noteStackStateSchema>;

export const setNoteStackStateInputSchema = z.object({
  collapsed: z.boolean()
});
export type SetNoteStackStateInput = z.infer<typeof setNoteStackStateInputSchema>;

/// Полный порядок стопок для этого пользователя, от первой к последней.
export const reorderNoteStacksInputSchema = z.object({
  stackIds: z.array(z.string().min(1)).max(200)
});
export type ReorderNoteStacksInput = z.infer<typeof reorderNoteStacksInputSchema>;
