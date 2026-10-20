import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  CHAT_ARCHIVE_TITLE_SOURCES,
  chatArchiveFallbackTitle,
  isChatArchiveMessage,
  parseChatArchiveLine,
  type ChatArchiveConversation,
  type ChatArchiveImportQuery,
  type ChatArchiveImportResult,
  type ChatArchiveImportState,
  type ChatArchiveImportStateQuery,
  type ChatArchiveKind,
  type ChatArchiveLinesPage,
  type ChatArchiveLinesQuery,
  type ChatArchiveRawPage,
  type ChatArchiveRawQuery,
  type ChatArchiveRole,
  type ChatArchiveSearchHit,
  type ChatArchiveSearchQuery,
  type ChatArchiveSource,
  type ChatArchiveTitleSource,
  type UpdateChatArchiveConversationInput
} from "@orion/shared-types";
import { createHash } from "node:crypto";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";

/** Пачка импорта: столько строк и байт укладывается в одну транзакцию (интерактивная транзакция Prisma — 5 с). */
export const CHAT_ARCHIVE_IMPORT_MAX_LINES = 2000;
export const CHAT_ARCHIVE_IMPORT_MAX_BYTES = 8 * 1024 * 1024;
/** Страница исходных строк режется по объёму, но всегда содержит хотя бы одну строку. */
const RAW_PAGE_BYTES = 4 * 1024 * 1024;
const CREATE_CHUNK = 500;

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const titleRank = (source: string) => CHAT_ARCHIVE_TITLE_SOURCES.indexOf(source as ChatArchiveTitleSource);

/**
 * Архив чатов. Инварианты обычного workspace-модуля (CLAUDE.md): членство проверяется первым, всё идёт через
 * `withUser` (RLS), наружу — DTO, собранный руками (`toDto`). Сверх того архив ЛИЧНЫЙ: RLS пускает только владельца
 * строки, а каждый запрос ещё и фильтрует по `userId` — член пространства не видит чужих разговоров даже по id.
 *
 * Импорт дописывает строки по номеру: повтор той же пачки ничего не меняет (перекрытие сверяется по sha256), разрыв или
 * расхождение с уже сохранённым — 409 с `lineCount`, по которому импортёр продолжает с нужного места.
 */
@Injectable()
export class ChatArchiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async list(userId: string, workspaceId: string, source?: ChatArchiveSource): Promise<ChatArchiveConversation[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.chatArchiveConversation.findMany({
        where: { workspaceId, userId, ...(source ? { source } : {}) },
        orderBy: [{ lastAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }]
      });
    });
    return rows.map(toDto);
  }

  async get(userId: string, workspaceId: string, conversationId: string): Promise<ChatArchiveConversation> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return this.assertConversationTx(tx, userId, workspaceId, conversationId);
    });
    return toDto(row);
  }

  async lines(userId: string, workspaceId: string, conversationId: string, query: ChatArchiveLinesQuery): Promise<ChatArchiveLinesPage> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertConversationTx(tx, userId, workspaceId, conversationId);
      // Без raw: длину считает база, сами строки (бывают в сотни КБ) остаются на сервере.
      const messagesOnly = query.messagesOnly
        ? Prisma.sql`AND "role" IN ('user', 'assistant') AND "kind" = 'text'`
        : Prisma.empty;
      const rows = await tx.$queryRaw<Array<{ seq: number; role: string; kind: string; text: string; at: Date | null; rawLength: number }>>`
        SELECT "seq", "role", "kind", "text", "at", length("raw")::int AS "rawLength"
        FROM "chat_archive_lines"
        WHERE "conversationId" = ${conversationId} AND "userId" = ${userId} AND "seq" > ${query.after} ${messagesOnly}
        ORDER BY "seq" ASC
        LIMIT ${query.limit + 1}`;
      const page = rows.slice(0, query.limit);
      return {
        lines: page.map((row) => ({
          seq: row.seq,
          role: row.role as ChatArchiveRole,
          kind: row.kind as ChatArchiveKind,
          text: row.text,
          at: row.at ? row.at.toISOString() : null,
          rawLength: row.rawLength
        })),
        nextSeq: rows.length > query.limit ? page[page.length - 1]!.seq : null
      };
    });
  }

  async raw(userId: string, workspaceId: string, conversationId: string, query: ChatArchiveRawQuery): Promise<ChatArchiveRawPage> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertConversationTx(tx, userId, workspaceId, conversationId);
      if (query.only !== undefined) {
        const line = await tx.chatArchiveLine.findUnique({ where: { conversationId_seq: { conversationId, seq: query.only } }, select: { seq: true, raw: true } });
        if (!line) throw new NotFoundException("Строка не найдена");
        return { lines: [line], nextSeq: null };
      }
      const sizes = await tx.$queryRaw<Array<{ seq: number; bytes: number }>>`
        SELECT "seq", octet_length("raw")::int AS "bytes" FROM "chat_archive_lines"
        WHERE "conversationId" = ${conversationId} AND "userId" = ${userId} AND "seq" > ${query.after}
        ORDER BY "seq" ASC LIMIT 2001`;
      let total = 0;
      let last = -1;
      for (const [index, size] of sizes.entries()) {
        if (index >= 2000 || (index > 0 && total + size.bytes > RAW_PAGE_BYTES)) break;
        total += size.bytes;
        last = size.seq;
      }
      if (last < 0) return { lines: [], nextSeq: null };
      const lines = await tx.chatArchiveLine.findMany({
        where: { conversationId, userId, seq: { gt: query.after, lte: last } },
        orderBy: { seq: "asc" },
        select: { seq: true, raw: true }
      });
      return { lines, nextSeq: sizes.some((size) => size.seq > last) ? last : null };
    });
  }

  async rename(userId: string, workspaceId: string, conversationId: string, input: UpdateChatArchiveConversationInput): Promise<ChatArchiveConversation> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertConversationTx(tx, userId, workspaceId, conversationId);
      return tx.chatArchiveConversation.update({ where: { id: conversationId }, data: { title: input.title, titleSource: "manual" } });
    });
    return toDto(row);
  }

  async remove(userId: string, workspaceId: string, conversationId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertConversationTx(tx, userId, workspaceId, conversationId);
      await tx.chatArchiveConversation.delete({ where: { id: conversationId } });
    });
  }

  async search(userId: string, workspaceId: string, query: ChatArchiveSearchQuery): Promise<ChatArchiveSearchHit[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.chatArchiveLine.findMany({
        where: {
          workspaceId,
          userId,
          role: { in: ["user", "assistant"] },
          kind: "text",
          text: { contains: query.q, mode: "insensitive" },
          ...(query.source ? { conversation: { source: query.source } } : {})
        },
        orderBy: [{ at: { sort: "desc", nulls: "last" } }, { seq: "desc" }],
        take: query.limit,
        select: { seq: true, role: true, text: true, at: true, conversation: { select: { id: true, title: true, source: true, projectPath: true } } }
      });
    });
    return rows.map((row) => ({
      conversationId: row.conversation.id,
      title: row.conversation.title,
      source: row.conversation.source as ChatArchiveSource,
      projectPath: row.conversation.projectPath,
      seq: row.seq,
      role: row.role as ChatArchiveRole,
      snippet: snippetAround(row.text, query.q),
      at: row.at ? row.at.toISOString() : null
    }));
  }

  async importState(userId: string, workspaceId: string, query: ChatArchiveImportStateQuery): Promise<ChatArchiveImportState> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const conversation = await tx.chatArchiveConversation.findUnique({
        where: { workspaceId_userId_source_externalId: { workspaceId, userId, source: query.source, externalId: query.externalId } }
      });
      if (!conversation) return { conversationId: null, lineCount: 0, lastSha: null };
      const last = conversation.lineCount > 0
        ? await tx.chatArchiveLine.findUnique({ where: { conversationId_seq: { conversationId: conversation.id, seq: conversation.lineCount - 1 } }, select: { sha: true } })
        : null;
      return { conversationId: conversation.id, lineCount: conversation.lineCount, lastSha: last?.sha ?? null };
    });
  }

  /** Дописать строки файла начиная с `fromSeq`. Строки — как в файле, без "\n". */
  async importLines(userId: string, workspaceId: string, query: ChatArchiveImportQuery, rawLines: readonly string[]): Promise<ChatArchiveImportResult> {
    if (rawLines.length === 0) throw new BadRequestException("Нет строк для импорта");
    if (rawLines.length > CHAT_ARCHIVE_IMPORT_MAX_LINES) throw new BadRequestException(`Не больше ${CHAT_ARCHIVE_IMPORT_MAX_LINES} строк за запрос`);
    // Разбор и хеши — до транзакции: это CPU, а не база.
    const incoming = rawLines.map((raw, index) => ({ seq: query.fromSeq + index, raw, sha: sha256(raw), parsed: parseChatArchiveLine(query.source, raw) }));
    try {
      return await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
        const key = { workspaceId, userId, source: query.source, externalId: query.externalId };
        let conversation = await tx.chatArchiveConversation.findUnique({ where: { workspaceId_userId_source_externalId: key } });
        if (conversation) {
          // Два импорта одной сессии (хук и ручной запуск) идут друг за другом, а не вперемешку.
          await tx.$executeRaw`SELECT 1 FROM "chat_archive_conversations" WHERE "id" = ${conversation.id} FOR UPDATE`;
          conversation = await tx.chatArchiveConversation.findUniqueOrThrow({ where: { id: conversation.id } });
        }
        const lineCount = conversation?.lineCount ?? 0;
        if (query.fromSeq > lineCount) {
          throw new ConflictException({ code: "chat_archive_gap", message: `В архиве ${lineCount} строк, а пришли строки с ${query.fromSeq}`, lineCount });
        }
        const overlap = Math.min(lineCount - query.fromSeq, incoming.length);
        if (conversation && overlap > 0) {
          const stored = await tx.chatArchiveLine.findMany({
            where: { conversationId: conversation.id, seq: { gte: query.fromSeq, lt: query.fromSeq + overlap } },
            select: { seq: true, sha: true }
          });
          const bySeq = new Map(stored.map((line) => [line.seq, line.sha]));
          const diverged = incoming.slice(0, overlap).find((line) => bySeq.get(line.seq) !== line.sha);
          if (diverged) {
            throw new ConflictException({ code: "chat_archive_diverged", message: `Строка ${diverged.seq} не совпадает с сохранённой: файл изменился не дописыванием`, lineCount });
          }
        }
        const fresh = incoming.slice(overlap);
        const projectPath = query.projectPath ?? fresh.find((line) => line.parsed.projectPath)?.parsed.projectPath ?? null;
        if (!conversation) {
          conversation = await tx.chatArchiveConversation.create({
            data: { ...key, title: chatArchiveFallbackTitle(""), titleSource: "fallback", projectPath }
          });
        }
        if (fresh.length === 0) return { conversation: toDto(conversation), appended: 0, skipped: overlap };

        for (let start = 0; start < fresh.length; start += CREATE_CHUNK) {
          await tx.chatArchiveLine.createMany({
            data: fresh.slice(start, start + CREATE_CHUNK).map((line) => ({
              workspaceId,
              userId,
              conversationId: conversation!.id,
              seq: line.seq,
              role: line.parsed.role,
              kind: line.parsed.kind,
              text: line.parsed.text,
              raw: line.raw,
              sha: line.sha,
              at: parseDate(line.parsed.at)
            }))
          });
        }

        const times = fresh.map((line) => parseDate(line.parsed.at)).filter((at): at is Date => at !== null);
        const firstAt = times.length > 0 ? new Date(Math.min(...times.map((at) => at.getTime()))) : null;
        const lastAt = times.length > 0 ? new Date(Math.max(...times.map((at) => at.getTime()))) : null;
        const title = nextTitle(conversation, fresh.map((line) => line.parsed));
        const updated = await tx.chatArchiveConversation.update({
          where: { id: conversation.id },
          data: {
            lineCount: lineCount + fresh.length,
            messageCount: { increment: fresh.filter((line) => isChatArchiveMessage(line.parsed)).length },
            ...(firstAt && (!conversation.startedAt || firstAt < conversation.startedAt) ? { startedAt: firstAt } : {}),
            ...(lastAt && (!conversation.lastAt || lastAt > conversation.lastAt) ? { lastAt } : {}),
            ...(conversation.projectPath === null && projectPath ? { projectPath } : {}),
            ...(title ? { title: title.value, titleSource: title.source } : {})
          }
        });
        return { conversation: toDto(updated), appended: fresh.length, skipped: overlap };
      });
    } catch (error) {
      // Первая пачка новой сессии из двух мест одновременно: проигравший повторит запрос и попадёт в ветку перекрытия.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException({ code: "chat_archive_busy", message: "Этот разговор сейчас импортируется — повторите запрос", lineCount: null });
      }
      throw error;
    }
  }

  /** Разговор должен принадлежать ЭТОМУ пространству и этому человеку. */
  private async assertConversationTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, conversationId: string) {
    const conversation = await tx.chatArchiveConversation.findUnique({ where: { id: conversationId } });
    if (!conversation || conversation.workspaceId !== workspaceId || conversation.userId !== userId) throw new NotFoundException("Разговор не найден");
    return conversation;
  }
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Последний заголовок из источника не слабее текущего; иначе — первая реплика человека, пока заголовка нет. */
function nextTitle(
  current: { title: string; titleSource: string },
  parsed: ReadonlyArray<ReturnType<typeof parseChatArchiveLine>>
): { value: string; source: ChatArchiveTitleSource } | null {
  if (current.titleSource === "manual") return null;
  let best: { value: string; source: ChatArchiveTitleSource } | null = null;
  for (const line of parsed) {
    if (!line.title) continue;
    const candidate = { value: line.title.value.slice(0, 300), source: line.title.strength };
    if (titleRank(candidate.source) >= titleRank(best?.source ?? current.titleSource)) best = candidate;
  }
  if (best) return best;
  if (current.titleSource !== "fallback" || current.title !== chatArchiveFallbackTitle("")) return null;
  const firstUser = parsed.find((line) => line.role === "user" && line.kind === "text" && line.text.trim() !== "");
  return firstUser ? { value: chatArchiveFallbackTitle(firstUser.text), source: "fallback" } : null;
}

function snippetAround(text: string, query: string): string {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  const start = Math.max(0, at - 80);
  const end = Math.min(text.length, (at < 0 ? 0 : at) + query.length + 120);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

function toDto(row: {
  id: string;
  workspaceId: string;
  source: string;
  externalId: string;
  title: string;
  titleSource: string;
  projectPath: string | null;
  startedAt: Date | null;
  lastAt: Date | null;
  lineCount: number;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}): ChatArchiveConversation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    source: row.source as ChatArchiveSource,
    externalId: row.externalId,
    title: row.title,
    titleSource: row.titleSource as ChatArchiveTitleSource,
    projectPath: row.projectPath,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    lastAt: row.lastAt ? row.lastAt.toISOString() : null,
    lineCount: row.lineCount,
    messageCount: row.messageCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
