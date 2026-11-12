import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  searchNoteText,
  type BrokenNoteLink,
  type NoteLinkEntry,
  type NoteLinks,
  type NoteRelated,
  type NoteRelatedReason,
  type NoteSearchResult
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

/** Сколько связанных заметок возвращаем — список для панели, а не обход всего графа. */
const RELATED_LIMIT = 50;

/** Глубина обхода wiki-ссылок при агрегации связанных (07, 7.2): дальше двух уровней не идём. */
const RELATED_WIKI_DEPTH = 2;

/** Предел числа сущностей, через которые ищем общие EntityLink, — защита от разросшегося графа. */
const RELATED_ENTITY_LINKS_LIMIT = 200;

type RelatedReasonMap = Map<string, Set<NoteRelatedReason>>;

/**
 * 07 (Заметки 2.0): ссылки, поиск внутри заметки и «связанные заметки».
 * Вынесено из NotesService, потому что это отдельный concern (чтение графа
 * ссылок), а не жизненный цикл заметки. Как и NotesService, каждый метод
 * сначала проверяет членство и работает в withUser — RLS остаётся границей.
 */
@Injectable()
export class NoteLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  /** Исходящие и входящие wiki-ссылки заметки с флагом broken. */
  async listLinks(userId: string, workspaceId: string, noteId: string): Promise<NoteLinks> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertNoteTx(tx, workspaceId, noteId);

      const [outgoingRows, incomingRows] = await Promise.all([
        tx.noteLink.findMany({
          where: { workspaceId, sourceNoteId: noteId },
          orderBy: { createdAt: "asc" }
        }),
        tx.noteLink.findMany({
          where: { workspaceId, targetNoteId: noteId },
          include: { source: { select: { id: true, title: true, deletedAt: true } } },
          orderBy: { createdAt: "asc" }
        })
      ]);

      const outgoing: NoteLinkEntry[] = outgoingRows.map((row) => ({
        id: row.id,
        direction: "outgoing",
        title: row.targetTitle,
        noteId: row.targetNoteId,
        broken: row.broken || row.targetNoteId === null
      }));

      const incoming: NoteLinkEntry[] = incomingRows
        .filter((row) => row.source && !row.source.deletedAt)
        .map((row) => ({
          id: row.id,
          direction: "incoming",
          title: row.source.title,
          noteId: row.source.id,
          broken: false
        }));

      return { outgoing, incoming };
    });
  }

  /** Все битые ссылки пространства — для экрана разбора. Источник живой, цель не найдена. */
  async listBrokenLinks(userId: string, workspaceId: string): Promise<BrokenNoteLink[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.noteLink.findMany({
        where: { workspaceId, broken: true, source: { deletedAt: null } },
        include: { source: { select: { id: true, title: true } } },
        orderBy: { createdAt: "asc" },
        take: 500
      });
    });
    return rows.map((row) => ({
      id: row.id,
      sourceNoteId: row.sourceNoteId,
      sourceTitle: row.source.title,
      targetTitle: row.targetTitle,
      createdAt: row.createdAt.toISOString()
    }));
  }

  /** Вхождения query в теле заметки с посчитанными смещениями и номерами строк. */
  async search(userId: string, workspaceId: string, noteId: string, query: string): Promise<NoteSearchResult> {
    const note = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return this.assertNoteTx(tx, workspaceId, noteId);
    });
    const found = searchNoteText(note.body, query);
    return {
      query: found.query,
      total: found.total,
      matches: found.matches.map((match) => ({ start: match.start, end: match.end, line: match.line, text: match.text })),
      truncated: found.truncated
    };
  }

  /**
   * «Связанные заметки»: wiki-ссылки в обе стороны (глубина 2), общие связи
   * EntityLink через любые сущности и общий проект. Заметки только читаются —
   * граф не перестраивается.
   */
  async related(userId: string, workspaceId: string, noteId: string): Promise<NoteRelated[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const note = await this.assertNoteTx(tx, workspaceId, noteId);
      const acc: RelatedReasonMap = new Map();

      // --- wiki-ссылки, глубина до двух уровней -----------------------------
      const firstHop = await this.wikiNeighboursTx(tx, workspaceId, noteId);
      for (const id of firstHop.outgoing) addReason(acc, id, "wiki-link");
      for (const id of firstHop.incoming) addReason(acc, id, "backlink");
      if (RELATED_WIKI_DEPTH >= 2) {
        for (const directId of new Set([...firstHop.outgoing, ...firstHop.incoming])) {
          const second = await this.wikiNeighboursTx(tx, workspaceId, directId);
          for (const id of [...second.outgoing, ...second.incoming]) {
            if (id !== noteId) addReason(acc, id, "wiki-link");
          }
        }
      }

      // --- общие EntityLink: заметка ↔ сущность ↔ другая заметка ------------
      const ownLinks = await tx.entityLink.findMany({
        where: { workspaceId, OR: [{ sourceType: "note", sourceId: noteId }, { targetType: "note", targetId: noteId }] },
        select: { sourceType: true, sourceId: true, targetType: true, targetId: true },
        take: RELATED_ENTITY_LINKS_LIMIT
      });
      for (const link of ownLinks) {
        const counterpart =
          link.sourceType === "note" && link.sourceId === noteId
            ? { type: link.targetType, id: link.targetId }
            : { type: link.sourceType, id: link.sourceId };
        if (counterpart.type === "note" && counterpart.id === noteId) continue;
        const shared = await tx.entityLink.findMany({
          where: {
            workspaceId,
            OR: [
              { sourceType: counterpart.type, sourceId: counterpart.id },
              { targetType: counterpart.type, targetId: counterpart.id }
            ]
          },
          select: { sourceType: true, sourceId: true, targetType: true, targetId: true },
          take: RELATED_ENTITY_LINKS_LIMIT
        });
        for (const edge of shared) {
          const otherNotes: string[] = [];
          if (edge.sourceType === "note" && edge.sourceId !== noteId) otherNotes.push(edge.sourceId);
          if (edge.targetType === "note" && edge.targetId !== noteId) otherNotes.push(edge.targetId);
          for (const otherId of otherNotes) addReason(acc, otherId, "entity-link");
        }
      }

      // --- общий проект -----------------------------------------------------
      if (note.projectId) {
        const siblings = await tx.note.findMany({
          where: {
            workspaceId,
            projectId: note.projectId,
            id: { not: noteId },
            deletedAt: null,
            archivedAt: null,
            isTemplate: false
          },
          select: { id: true },
          take: RELATED_LIMIT
        });
        for (const sibling of siblings) addReason(acc, sibling.id, "project");
      }

      if (acc.size === 0) return [];
      const ids = [...acc.keys()];
      const notes = await tx.note.findMany({
        where: { workspaceId, id: { in: ids }, deletedAt: null },
        select: { id: true, title: true, body: true }
      });
      const related: NoteRelated[] = notes.map((row) => ({
        noteId: row.id,
        title: row.title,
        snippet: leadingSnippet(row.body),
        reasons: [...(acc.get(row.id) ?? [])]
      }));
      related.sort((a, b) => b.reasons.length - a.reasons.length || a.title.localeCompare(b.title, "ru"));
      return related.slice(0, RELATED_LIMIT);
    });
  }

  /** Прямые wiki-соседи: разрешённые исходящие цели и живые источники входящих. */
  private async wikiNeighboursTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    noteId: string
  ): Promise<{ outgoing: string[]; incoming: string[] }> {
    const [out, inc] = await Promise.all([
      tx.noteLink.findMany({
        where: { workspaceId, sourceNoteId: noteId, targetNoteId: { not: null } },
        select: { targetNoteId: true },
        take: RELATED_ENTITY_LINKS_LIMIT
      }),
      tx.noteLink.findMany({
        where: { workspaceId, targetNoteId: noteId, broken: false },
        select: { sourceNoteId: true },
        take: RELATED_ENTITY_LINKS_LIMIT
      })
    ]);
    return {
      outgoing: out.flatMap((row) => (row.targetNoteId ? [row.targetNoteId] : [])),
      incoming: inc.map((row) => row.sourceNoteId)
    };
  }

  private async assertNoteTx(tx: Prisma.TransactionClient, workspaceId: string, noteId: string) {
    const note = await tx.note.findUnique({ where: { id: noteId } });
    if (!note || note.workspaceId !== workspaceId || note.deletedAt) throw new NotFoundException("Заметка не найдена");
    return note;
  }
}

/** Добавить причину к заметке, не теряя уже найденные (одна может быть связана несколькими способами). */
function addReason(acc: RelatedReasonMap, noteId: string, reason: NoteRelatedReason): void {
  const reasons = acc.get(noteId);
  if (reasons) reasons.add(reason);
  else acc.set(noteId, new Set([reason]));
}

/** Начало тела, сжатое до одной строки — для превью связанной заметки. */
function leadingSnippet(body: string, maxLength = 160): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength)}…` : flat;
}
