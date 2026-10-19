import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Note as DbNote, NoteRevision as DbNoteRevision, Prisma } from "@prisma/client";
import {
  wikiLinkTargets,
  type CreateNoteInput,
  type Note,
  type NoteBacklink,
  type NoteRevision,
  type NoteRevisionSummary,
  type NoteTitleRef,
  type NoteView,
  parseNoteNumber,
  type RenameNoteTagInput,
  type UpdateNoteInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

/** The bit of a note the link-sync + snapshot helpers need — a Prisma create/update result satisfies it. */
type NoteCore = { id: string; workspaceId: string; title: string; summary: string; body: string; tags: string[] };

/**
 * A content change within this window of the newest revision does not add
 * another one — a run of autosaves collapses to the single "before this
 * editing session" snapshot rather than one per keystroke-batch.
 */
const REVISION_MIN_GAP_MS = 3 * 60 * 1000;

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  /**
   * `search` (optional) runs a real Postgres full-text query instead of the
   * plain list — see `notes_search_idx` in the `search_fulltext_indexes`
   * migration. `websearch_to_tsquery` never throws on malformed input
   * (unlike `to_tsquery`), which is why it's the one safe to feed raw user
   * text. Runs inside the same `withUser` transaction as the ORM path, so
   * RLS applies identically — the isolation guarantee isn't ORM-specific.
   *
   * `view === "trash"` returns only soft-deleted notes (newest-deleted
   * first) and ignores `search`; every other value returns only live ones.
   * Both raw and ORM paths filter `deletedAt IS NULL` so a trashed note
   * never leaks into the normal list. `templates` toggles which side of the
   * `isTemplate` flag the active list shows (ignored for the trash).
   */
  async list(
    userId: string,
    workspaceId: string,
    search?: string,
    view: NoteView = "active",
    templates = false
  ): Promise<Note[]> {
    const notes = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);

      if (view === "trash") {
        return tx.note.findMany({
          where: { workspaceId, deletedAt: { not: null } },
          orderBy: { deletedAt: "desc" }
        });
      }

      const query = search?.trim();
      // "N-104" / "104" also finds the note with that short id (OR-ed with the text match).
      const idNumber = query ? parseNoteNumber(query) : null;

      if (view === "archive") {
        // Search works in the archive too (it used to be silently ignored there,
        // so the box looked functional and did nothing). Same expression as the
        // active list, so the same GIN index serves both.
        if (query) {
          return tx.$queryRaw<NoteRow[]>`
            SELECT * FROM "notes"
            WHERE "workspaceId" = ${workspaceId}
              AND "deletedAt" IS NULL
              AND "archivedAt" IS NOT NULL
              AND "isTemplate" = ${templates}
              AND (to_tsvector('russian', "title" || ' ' || "summary" || ' ' || "body" || ' ' || immutable_array_to_string("tags", ' '))
                  @@ websearch_to_tsquery('russian', ${query}) OR "number" = ${idNumber})
            ORDER BY ts_rank(
              to_tsvector('russian', "title" || ' ' || "summary" || ' ' || "body" || ' ' || immutable_array_to_string("tags", ' ')),
              websearch_to_tsquery('russian', ${query})
            ) DESC
          `;
        }
        return tx.note.findMany({
          where: { workspaceId, deletedAt: null, archivedAt: { not: null }, isTemplate: templates },
          orderBy: { archivedAt: "desc" }
        });
      }

      if (query) {
        return tx.$queryRaw<NoteRow[]>`
          SELECT * FROM "notes"
          WHERE "workspaceId" = ${workspaceId}
            AND "deletedAt" IS NULL
            AND "archivedAt" IS NULL
            AND "isTemplate" = ${templates}
            AND (to_tsvector('russian', "title" || ' ' || "summary" || ' ' || "body" || ' ' || immutable_array_to_string("tags", ' '))
                @@ websearch_to_tsquery('russian', ${query}) OR "number" = ${idNumber})
          ORDER BY ts_rank(
            to_tsvector('russian', "title" || ' ' || "summary" || ' ' || "body" || ' ' || immutable_array_to_string("tags", ' ')),
            websearch_to_tsquery('russian', ${query})
          ) DESC
        `;
      }
      return tx.note.findMany({
        where: { workspaceId, deletedAt: null, archivedAt: null, isTemplate: templates },
        // editedAt, not updatedAt: a pin/unpin bumps updatedAt but not
        // editedAt, so ordering by it keeps pinning from reshuffling the
        // list. `nulls: "last"` covers pre-v0.8 rows the backfill missed.
        orderBy: [
          { pinnedAt: { sort: "desc", nulls: "last" } },
          { editedAt: { sort: "desc", nulls: "last" } },
          { updatedAt: "desc" }
        ]
      });
    });
    return notes.map(toDto);
  }

  /** `{ id, title, snippet }` for every live non-template note — feeds the `[[wiki link]]` autocomplete and its hover preview. */
  async listTitles(userId: string, workspaceId: string): Promise<NoteTitleRef[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.note.findMany({
        where: { workspaceId, deletedAt: null, archivedAt: null, isTemplate: false },
        select: { id: true, title: true, body: true },
        orderBy: { title: "asc" }
      });
    });
    return rows.map((row) => ({ id: row.id, title: row.title, snippet: leadingSnippet(row.body) }));
  }

  /**
   * Rename tag `from` to `to` on every note in the workspace (trash and
   * archive included — it's the user's whole vocabulary). A plain rename
   * when `to` is new; a merge (the tag list is de-duped) when it exists.
   * `to === from` is a no-op. Returns how many notes changed.
   */
  async renameTag(userId: string, workspaceId: string, input: RenameNoteTagInput): Promise<{ updated: number }> {
    const from = input.from.trim();
    const to = input.to.trim();
    if (!from || !to || from === to) return { updated: 0 };
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const affected = await tx.note.findMany({
        where: { workspaceId, tags: { has: from } },
        select: { id: true, tags: true }
      });
      for (const note of affected) {
        const next = note.tags.filter((t) => t !== from);
        if (!next.includes(to)) next.push(to);
        await tx.note.update({ where: { id: note.id }, data: { tags: next, revision: { increment: 1 } } });
      }
      return { updated: affected.length };
    });
  }

  /** Remove tag `tag` from every note in the workspace. Returns how many notes changed. */
  async deleteTag(userId: string, workspaceId: string, tag: string): Promise<{ updated: number }> {
    const target = tag.trim();
    if (!target) return { updated: 0 };
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const affected = await tx.note.findMany({
        where: { workspaceId, tags: { has: target } },
        select: { id: true, tags: true }
      });
      for (const note of affected) {
        await tx.note.update({
          where: { id: note.id },
          data: { tags: note.tags.filter((t) => t !== target), revision: { increment: 1 } }
        });
      }
      return { updated: affected.length };
    });
  }

  /** Live notes whose body `[[links]]` resolve to `noteId` — deduped by source. */
  async backlinks(userId: string, workspaceId: string, noteId: string): Promise<NoteBacklink[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, noteId);
      const links = await tx.noteLink.findMany({
        where: { workspaceId, targetNoteId: noteId },
        include: { source: { select: { id: true, title: true, body: true, deletedAt: true } } },
        orderBy: { createdAt: "asc" }
      });
      const seen = new Set<string>();
      const out: NoteBacklink[] = [];
      for (const link of links) {
        const src = link.source;
        if (!src || src.deletedAt || src.id === noteId || seen.has(src.id)) continue;
        seen.add(src.id);
        out.push({ id: src.id, title: src.title, snippet: snippetAround(src.body) });
      }
      return out;
    });
  }

  async getOne(userId: string, workspaceId: string, noteId: string): Promise<Note> {
    const note = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return this.assertOwnedTx(tx, workspaceId, noteId);
    });
    if (note.deletedAt) throw new NotFoundException("Заметка не найдена");
    return toDto(note);
  }

  /** `agentName` is set only by the AI Bridge (ADR-0007): the note is marked as created by that agent. */
  async create(userId: string, workspaceId: string, input: CreateNoteInput, agentName?: string): Promise<Note> {
    const note = await this.prisma.withUser(userId, (tx) => this.createTx(tx, userId, workspaceId, input, agentName));
    return toDto(note);
  }

  /**
   * The body of `create()`, minus the `withUser` wrap — see
   * `TasksService.createTx` for why (U03 Часть 1 / `SearchService.
   * createAndLink`). Caller owns the transaction and the membership check.
   */
  async createTx(
    tx: Prisma.TransactionClient,
    userId: string,
    workspaceId: string,
    input: CreateNoteInput,
    agentName?: string,
    /** Гибридная синхронизация (ADR-0016): идентификатор, выданный устройством. */
    clientId?: string
  ): Promise<DbNote> {
    await this.assertProjectTx(tx, workspaceId, input.projectId ?? null);
    const created = await tx.note.create({
      data: {
        ...(clientId ? { id: clientId } : {}),
        workspaceId,
        title: input.title,
        summary: input.summary,
        body: input.body,
        tags: input.tags,
        eventAt: input.eventAt ?? null,
        isTemplate: input.isTemplate ?? false,
        projectId: input.projectId ?? null,
        privateToUserId: input.isPrivate ? userId : null,
        editedAt: new Date(),
        createdByAgent: agentName ?? null
      }
    });
    await this.syncOutgoingLinks(tx, created);
    await this.reresolveIncomingLinks(tx, created);
    return created;
  }

  /**
   * `editedAt` is bumped only when the note's content (title/body/tags)
   * actually changed — a bare `{ pinnedAt }` or `{ eventAt }` PATCH leaves
   * it alone, which is the whole point of the field (see schema comment).
   * A body change rebuilds this note's outgoing `[[links]]`; a title change
   * re-resolves everyone else's links that might now point here (or stop).
   */
  async update(userId: string, workspaceId: string, noteId: string, input: UpdateNoteInput, agentName?: string): Promise<Note> {
    const note = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return this.updateTx(tx, workspaceId, noteId, input, agentName, userId);
    });
    return toDto(note);
  }

  /** Тело `update()` без обёртки `withUser` — им пользуется гибридная синхронизация (ADR-0016); членство проверил вызывающий. */
  async updateTx(tx: Prisma.TransactionClient, workspaceId: string, noteId: string, input: UpdateNoteInput, agentName?: string, actorId?: string): Promise<DbNote> {
    const { expectedRevision, isPrivate, ...patch } = input;
    let privacy: { privateToUserId: string | null } | Record<string, never> = {};
    const touchesContent =
      patch.title !== undefined || patch.summary !== undefined || patch.body !== undefined || patch.tags !== undefined;
    {
      const before = await this.assertOwnedTx(tx, workspaceId, noteId);
      // ADR-0021: личной заметку делает только человек (actorId известен); синхронизация и агенты флаг не трогают.
      // Общую заметку личной не сделать: иначе участник мог бы спрятать чужую запись (в заметке нет поля «автор»).
      // Личную можно опубликовать; нужна копия — создайте новую личную.
      if (isPrivate !== undefined && actorId) {
        if (isPrivate && before.privateToUserId === null) throw new ConflictException("Общую заметку нельзя сделать личной — создайте новую личную заметку");
        privacy = { privateToUserId: isPrivate ? actorId : null };
      }
      if (patch.projectId !== undefined) await this.assertProjectTx(tx, workspaceId, patch.projectId);
      if (touchesContent) await this.maybeSnapshot(tx, before);
      // CAS (S11): the revision check lives in the UPDATE's WHERE clause, not
      // in a separate read-then-compare — a plain "read before, compare, then
      // write" would race two concurrent editors that both read the same
      // `before.revision` and both pass the check before either commits.
      // `updateMany` with `revision` in `where` makes the check-and-increment
      // a single atomic statement: at most one of two racing writers can
      // match a given revision value.
      // R18-02: `expectedRevision` is optional on the wire (some non-content
      // PATCHes never send it — see the schema comment), but a
      // content-touching write must never skip the CAS check entirely just
      // because the caller omitted the field, or a stale client can clobber
      // a concurrent write with nothing in the WHERE clause to catch it
      // (Codex 18-REVIEW-FINAL-PASS, R18-02). When omitted on a
      // content-touching update, fall back to the revision this same
      // transaction just read (`before.revision`) — still closes the race
      // against anything that committed between that read and this write,
      // without forcing every caller to start sending the field.
      const effectiveExpectedRevision = touchesContent ? (expectedRevision ?? before.revision) : expectedRevision;
      const result = await tx.note.updateMany({
        where: { id: noteId, ...(effectiveExpectedRevision !== undefined ? { revision: effectiveExpectedRevision } : {}) },
        data: touchesContent
          ? // `editedByAgent` is rewritten on every content edit: a human edit after an agent's clears the mark.
            { ...patch, ...privacy, editedAt: new Date(), editedByAgent: agentName ?? null, revision: { increment: 1 } }
          : { ...patch, ...privacy, revision: { increment: 1 } }
      });
      if (result.count === 0) {
        // `before` already proved the note exists and is owned by this
        // workspace, so a zero-row update here can only mean the revision
        // moved under us between the read above and this statement.
        const current = await tx.note.findUniqueOrThrow({ where: { id: noteId } });
        throw new ConflictException({
          // Nest's HttpException reserves/overwrites a top-level `error` key
          // with the HTTP reason phrase ("Conflict") when the body is a
          // plain object, so the discriminator the client matches on has to
          // live under a different name — `code`, not `error`.
          code: "note_revision_conflict",
          message: "Заметку сохранил кто-то другой, пока вы редактировали — перезагрузите последнюю версию",
          currentRevision: current.revision,
          current: toDto(current)
        });
      }
      const updated = await tx.note.findUniqueOrThrow({ where: { id: noteId } });
      if (patch.body !== undefined) await this.syncOutgoingLinks(tx, updated);
      if (patch.title !== undefined) await this.reresolveIncomingLinks(tx, updated);
      return updated;
    }
  }

  /** Мягкое удаление (корзина) внутри чужой транзакции — см. `updateTx`. */
  async removeTx(tx: Prisma.TransactionClient, workspaceId: string, noteId: string): Promise<void> {
    await this.assertOwnedTx(tx, workspaceId, noteId);
    await tx.note.update({ where: { id: noteId }, data: { deletedAt: new Date(), revision: { increment: 1 } } });
    await tx.noteLink.deleteMany({ where: { sourceNoteId: noteId } });
    await tx.noteLink.updateMany({ where: { targetNoteId: noteId }, data: { targetNoteId: null } });
  }

  /** Soft delete — moves the note to the trash. NoteTrashPurgeService hard-deletes it later. */
  async remove(userId: string, workspaceId: string, noteId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, noteId);
      await tx.note.update({ where: { id: noteId }, data: { deletedAt: new Date(), revision: { increment: 1 } } });
      // A trashed note is neither a link source nor a backlink target.
      await tx.noteLink.deleteMany({ where: { sourceNoteId: noteId } });
      await tx.noteLink.updateMany({ where: { targetNoteId: noteId }, data: { targetNoteId: null } });
    });
  }

  async restore(userId: string, workspaceId: string, noteId: string): Promise<Note> {
    const note = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, noteId);
      const restored = await tx.note.update({ where: { id: noteId }, data: { deletedAt: null, revision: { increment: 1 } } });
      await this.syncOutgoingLinks(tx, restored);
      await this.reresolveIncomingLinks(tx, restored);
      return restored;
    });
    return toDto(note);
  }

  /** Irreversible hard delete — "удалить навсегда" from the trash view. */
  async purge(userId: string, workspaceId: string, noteId: string): Promise<void> {
    // note_links clean themselves up via FK: source → CASCADE, target → SET NULL.
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, noteId);
      await tx.note.delete({ where: { id: noteId } });
    });
  }

  /**
   * Open (or create) today's "daily note" for the workspace. The date is
   * the server's local calendar day, stored as a plain DATE. A trashed
   * daily note for today is revived rather than duplicated — the
   * `@@unique([workspaceId, dailyOn])` constraint wouldn't allow a second.
   */
  async openDaily(userId: string, workspaceId: string): Promise<Note> {
    const today = utcDateOnly(new Date());
    const note = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const existing = await tx.note.findFirst({ where: { workspaceId, dailyOn: today } });
      if (existing && !existing.deletedAt) return existing;
      if (existing) {
        const revived = await tx.note.update({
          where: { id: existing.id },
          data: { deletedAt: null, editedAt: new Date(), revision: { increment: 1 } }
        });
        await this.syncOutgoingLinks(tx, revived);
        await this.reresolveIncomingLinks(tx, revived);
        return revived;
      }
      const created = await tx.note.create({
        data: {
          workspaceId,
          title: dailyTitle(today),
          body: await dailyBodyFromTemplate(tx, workspaceId),
          dailyOn: today,
          editedAt: new Date()
        }
      });
      await this.reresolveIncomingLinks(tx, created);
      return created;
    });
    return toDto(note);
  }

  /** Rebuild `note`'s outgoing `[[wiki links]]` from its body — full replace. */
  private async syncOutgoingLinks(tx: Prisma.TransactionClient, note: NoteCore): Promise<void> {
    const titles = wikiLinkTargets(note.body);
    await tx.noteLink.deleteMany({ where: { sourceNoteId: note.id } });
    if (titles.length === 0) return;
    const matches = await tx.note.findMany({
      where: {
        workspaceId: note.workspaceId,
        deletedAt: null,
        id: { not: note.id },
        OR: titles.map((t) => ({ title: { equals: t, mode: "insensitive" as const } }))
      },
      select: { id: true, title: true }
    });
    const idByTitle = new Map(matches.map((m) => [m.title.toLowerCase(), m.id]));
    await tx.noteLink.createMany({
      data: titles.map((t) => ({
        workspaceId: note.workspaceId,
        sourceNoteId: note.id,
        targetNoteId: idByTitle.get(t.toLowerCase()) ?? null,
        targetTitle: t
      })),
      skipDuplicates: true
    });
  }

  /**
   * After `note`'s title changed (or it appeared/reappeared): detach
   * incoming links whose text no longer matches, and claim unresolved ones
   * whose text now does. Workspace-scoped and cheap at personal note counts.
   */
  private async reresolveIncomingLinks(tx: Prisma.TransactionClient, note: NoteCore): Promise<void> {
    await tx.noteLink.updateMany({
      where: {
        workspaceId: note.workspaceId,
        targetNoteId: note.id,
        NOT: { targetTitle: { equals: note.title, mode: "insensitive" } }
      },
      data: { targetNoteId: null }
    });
    await tx.noteLink.updateMany({
      where: {
        workspaceId: note.workspaceId,
        targetNoteId: null,
        targetTitle: { equals: note.title, mode: "insensitive" }
      },
      data: { targetNoteId: note.id }
    });
  }

  /** Asserts the note exists in this workspace and returns it (callers that only need the guard can ignore the result). */
  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, noteId: string): Promise<DbNote> {
    const note = await tx.note.findUnique({ where: { id: noteId } });
    if (!note || note.workspaceId !== workspaceId) {
      throw new NotFoundException("Заметка не найдена");
    }
    return note;
  }

  private async assertProjectTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string | null): Promise<void> {
    if (!projectId) return;
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project || project.workspaceId !== workspaceId) throw new NotFoundException("Проект не найден");
  }

  /** Version history for a note, newest first (no bodies — see `getRevision`). */
  async listRevisions(userId: string, workspaceId: string, noteId: string): Promise<NoteRevisionSummary[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, noteId);
      const rows = await tx.noteRevision.findMany({
        where: { noteId },
        select: { id: true, title: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 200
      });
      return rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.createdAt.toISOString() }));
    });
  }

  async getRevision(userId: string, workspaceId: string, noteId: string, revisionId: string): Promise<NoteRevision> {
    const revision = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, noteId);
      const row = await tx.noteRevision.findUnique({ where: { id: revisionId } });
      if (!row || row.noteId !== noteId) throw new NotFoundException("Версия не найдена");
      return row;
    });
    return toRevision(revision);
  }

  /**
   * Roll the note back to `revisionId`'s content. Always snapshots the
   * current state first (force), so a restore is itself undoable.
   *
   * R18-02: this changes title/body/tags exactly like a content `update`, so
   * it must participate in the same optimistic-concurrency CAS — previously
   * it wrote straight through `tx.note.update` without touching `revision`
   * at all, so an editor that had the note open before the restore stayed
   * "formally current" and could silently overwrite the just-restored
   * content with no conflict detected (Codex 18-REVIEW-FINAL-PASS, R18-02).
   * Same pattern as `update()`: CAS check lives in the `updateMany` WHERE
   * clause (atomic check-and-increment), `expectedRevision` is optional but
   * defaults to the revision this same transaction just read, so the restore
   * itself is also protected against a write that lands between that read
   * and this one (two concurrent restore/edit calls can't silently clobber
   * each other either).
   */
  async restoreRevision(
    userId: string,
    workspaceId: string,
    noteId: string,
    revisionId: string,
    expectedRevision?: number
  ): Promise<Note> {
    const note = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const current = await this.assertOwnedTx(tx, workspaceId, noteId);
      const revision = await tx.noteRevision.findUnique({ where: { id: revisionId } });
      if (!revision || revision.noteId !== noteId) throw new NotFoundException("Версия не найдена");
      await this.maybeSnapshot(tx, current, true);
      const effectiveExpectedRevision = expectedRevision ?? current.revision;
      const result = await tx.note.updateMany({
        where: { id: noteId, revision: effectiveExpectedRevision },
        data: {
          title: revision.title,
          summary: revision.summary,
          body: revision.body,
          tags: revision.tags,
          editedAt: new Date(),
          revision: { increment: 1 }
        }
      });
      if (result.count === 0) {
        const currentRow = await tx.note.findUniqueOrThrow({ where: { id: noteId } });
        throw new ConflictException({
          code: "note_revision_conflict",
          message: "Заметку изменили, пока восстанавливалась версия — перезагрузите последнюю версию и повторите",
          currentRevision: currentRow.revision,
          current: toDto(currentRow)
        });
      }
      const updated = await tx.note.findUniqueOrThrow({ where: { id: noteId } });
      await this.syncOutgoingLinks(tx, updated);
      await this.reresolveIncomingLinks(tx, updated);
      return updated;
    });
    return toDto(note);
  }

  /**
   * Snapshot `note`'s current content into `note_revisions` — but not if the
   * newest revision is younger than `REVISION_MIN_GAP_MS` (unless `force`).
   */
  private async maybeSnapshot(tx: Prisma.TransactionClient, note: NoteCore, force = false): Promise<void> {
    if (!force) {
      const last = await tx.noteRevision.findFirst({
        where: { noteId: note.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true }
      });
      if (last && Date.now() - last.createdAt.getTime() < REVISION_MIN_GAP_MS) return;
    }
    await tx.noteRevision.create({
      data: {
        workspaceId: note.workspaceId,
        noteId: note.id,
        title: note.title,
        summary: note.summary,
        body: note.body,
        tags: note.tags
      }
    });
  }
}

/** Shape shared by the ORM path (Prisma.Note) and the raw full-text search path — same columns either way. */
type NoteRow = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  title: string;
  number: number | null;
  summary: string;
  body: string;
  tags: string[];
  pinnedAt: Date | null;
  eventAt: Date | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  archivedAt: Date | null;
  dailyOn: Date | null;
  isTemplate: boolean;
  privateToUserId: string | null;
  revision: number;
  createdByAgent: string | null;
  editedByAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Local calendar day at UTC midnight — the form Prisma's `@db.Date` round-trips cleanly. */
function utcDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** Daily-note title: plain `YYYY-MM-DD`, so `[[2026-09-08]]` links to it naturally. */
function dailyTitle(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Copy the seeded «Ежедневная» template (or the oldest template) into a new daily note. */
async function dailyBodyFromTemplate(tx: Prisma.TransactionClient, workspaceId: string): Promise<string> {
  const named = await tx.note.findFirst({
    where: { workspaceId, isTemplate: true, deletedAt: null, title: "Ежедневная" },
    orderBy: { createdAt: "asc" }
  });
  if (named) return named.body;
  const any = await tx.note.findFirst({
    where: { workspaceId, isTemplate: true, deletedAt: null },
    orderBy: { createdAt: "asc" }
  });
  return any?.body ?? "";
}

function toRevision(r: DbNoteRevision): NoteRevision {
  return {
    id: r.id,
    noteId: r.noteId,
    title: r.title,
    summary: r.summary,
    body: r.body,
    tags: r.tags,
    createdAt: r.createdAt.toISOString()
  };
}

/** Start of a note's own body, whitespace-collapsed/truncated — for the `[[wiki link]]` hover preview. */
function leadingSnippet(body: string, maxLength = 160): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength)}…` : flat;
}

/** A short, whitespace-collapsed excerpt of a note body around its first `[[link]]`. */
function snippetAround(body: string, radius = 90): string {
  const flat = body.replace(/\s+/g, " ").trim();
  const at = flat.indexOf("[[");
  if (at < 0) return flat.slice(0, radius * 2);
  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + radius);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

function toDto(note: NoteRow): Note {
  return {
    id: note.id,
    workspaceId: note.workspaceId,
    projectId: note.projectId,
    title: note.title,
    number: note.number,
    summary: note.summary,
    body: note.body,
    tags: note.tags,
    pinnedAt: note.pinnedAt ? note.pinnedAt.toISOString() : null,
    eventAt: note.eventAt ? note.eventAt.toISOString() : null,
    editedAt: note.editedAt ? note.editedAt.toISOString() : null,
    deletedAt: note.deletedAt ? note.deletedAt.toISOString() : null,
    archivedAt: note.archivedAt ? note.archivedAt.toISOString() : null,
    dailyOn: note.dailyOn ? note.dailyOn.toISOString().slice(0, 10) : null,
    isTemplate: note.isTemplate,
    isPrivate: note.privateToUserId !== null,
    revision: note.revision,
    createdByAgent: note.createdByAgent,
    editedByAgent: note.editedByAgent,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString()
  };
}

export { toDto as toNoteDto };
