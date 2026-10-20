import { z } from "zod";

export * from "./parse";

/**
 * Архив чатов — zod-контракт модуля (PLATFORM_AUDIT G15). В `@orion/shared-types` он попадает через автогенерируемый
 * `modules-ext/registry.generated.ts`. Схемы ответов — без `.default(...)`, входные — с ним.
 *
 * Разговор — это исходный файл транскрипта (jsonl Claude Code или Codex), сохранённый построчно и без изменений
 * (`raw`), плюс извлечённый для чтения и поиска текст каждой строки. Архив личный: его видит только тот, кто импортировал.
 */

export const CHAT_ARCHIVE_SOURCES = ["claude-code", "codex"] as const;
export const chatArchiveSourceSchema = z.enum(CHAT_ARCHIVE_SOURCES);
export type ChatArchiveSource = z.infer<typeof chatArchiveSourceSchema>;

export const CHAT_ARCHIVE_SOURCE_LABELS: Record<ChatArchiveSource, string> = {
  "claude-code": "Claude Code",
  codex: "Codex"
};

/** user/assistant — реплики; tool — результаты инструментов; system — инструкции; meta — служебные строки источника. */
export const CHAT_ARCHIVE_ROLES = ["user", "assistant", "tool", "system", "meta"] as const;
export const chatArchiveRoleSchema = z.enum(CHAT_ARCHIVE_ROLES);
export type ChatArchiveRole = z.infer<typeof chatArchiveRoleSchema>;

export const CHAT_ARCHIVE_KINDS = ["text", "tool_call", "tool_result", "thinking", "meta"] as const;
export const chatArchiveKindSchema = z.enum(CHAT_ARCHIVE_KINDS);
export type ChatArchiveKind = z.infer<typeof chatArchiveKindSchema>;

/** Чем выше, тем сильнее: импорт меняет заголовок, только если новый не слабее; `manual` (правка в ORION) импорт не трогает. */
export const CHAT_ARCHIVE_TITLE_SOURCES = ["fallback", "auto", "custom", "manual"] as const;
export const chatArchiveTitleSourceSchema = z.enum(CHAT_ARCHIVE_TITLE_SOURCES);
export type ChatArchiveTitleSource = z.infer<typeof chatArchiveTitleSourceSchema>;

export const chatArchiveConversationSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  source: chatArchiveSourceSchema,
  externalId: z.string(),
  title: z.string(),
  titleSource: chatArchiveTitleSourceSchema,
  projectPath: z.string().nullable(),
  startedAt: z.string().nullable(),
  lastAt: z.string().nullable(),
  lineCount: z.number().int(),
  messageCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ChatArchiveConversation = z.infer<typeof chatArchiveConversationSchema>;

/** Строка для чтения: без `raw` (он бывает в сотни КБ) — его отдаёт отдельный запрос. */
export const chatArchiveLineSchema = z.object({
  seq: z.number().int(),
  role: chatArchiveRoleSchema,
  kind: chatArchiveKindSchema,
  text: z.string(),
  at: z.string().nullable(),
  rawLength: z.number().int()
});
export type ChatArchiveLine = z.infer<typeof chatArchiveLineSchema>;

export const chatArchiveLinesPageSchema = z.object({
  lines: z.array(chatArchiveLineSchema),
  /** С какого seq просить следующую страницу; null — дальше строк нет. */
  nextSeq: z.number().int().nullable()
});
export type ChatArchiveLinesPage = z.infer<typeof chatArchiveLinesPageSchema>;

export const chatArchiveLinesQuerySchema = z.object({
  after: z.coerce.number().int().min(-1).default(-1),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
  /** Только реплики (user/assistant, text) — для агента, которому не нужны вызовы инструментов. */
  messagesOnly: z.enum(["true", "false"]).default("false").transform((value) => value === "true")
});
export type ChatArchiveLinesQuery = z.infer<typeof chatArchiveLinesQuerySchema>;

/** Исходные строки по порядку — для «показать как есть» и выгрузки оригинала; страница режется по объёму. */
export const chatArchiveRawPageSchema = z.object({
  lines: z.array(z.object({ seq: z.number().int(), raw: z.string() })),
  nextSeq: z.number().int().nullable()
});
export type ChatArchiveRawPage = z.infer<typeof chatArchiveRawPageSchema>;

export const chatArchiveRawQuerySchema = z.object({
  after: z.coerce.number().int().min(-1).default(-1),
  /** Одна строка (seq) вместо страницы. */
  only: z.coerce.number().int().min(0).optional()
});
export type ChatArchiveRawQuery = z.infer<typeof chatArchiveRawQuerySchema>;

export const updateChatArchiveConversationInputSchema = z.object({
  title: z.string().trim().min(1, "Название обязательно").max(300)
});
export type UpdateChatArchiveConversationInput = z.infer<typeof updateChatArchiveConversationInputSchema>;

export const chatArchiveSearchQuerySchema = z.object({
  q: z.string().trim().min(2, "Не короче 2 символов").max(200),
  source: chatArchiveSourceSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});
export type ChatArchiveSearchQuery = z.infer<typeof chatArchiveSearchQuerySchema>;

export const chatArchiveSearchHitSchema = z.object({
  conversationId: z.string(),
  title: z.string(),
  source: chatArchiveSourceSchema,
  projectPath: z.string().nullable(),
  seq: z.number().int(),
  role: chatArchiveRoleSchema,
  snippet: z.string(),
  at: z.string().nullable()
});
export type ChatArchiveSearchHit = z.infer<typeof chatArchiveSearchHitSchema>;

/** Что уже лежит в архиве по сессии: импортёр продолжает с `lineCount` и сверяет хвост по `lastSha`. */
export const chatArchiveImportStateQuerySchema = z.object({
  source: chatArchiveSourceSchema,
  externalId: z.string().trim().min(1).max(200)
});
export type ChatArchiveImportStateQuery = z.infer<typeof chatArchiveImportStateQuerySchema>;

export const chatArchiveImportStateSchema = z.object({
  conversationId: z.string().nullable(),
  lineCount: z.number().int(),
  lastSha: z.string().nullable()
});
export type ChatArchiveImportState = z.infer<typeof chatArchiveImportStateSchema>;

/**
 * Параметры импорта — в строке запроса; тело — сами строки файла (`application/x-ndjson`, строки через "\n").
 * `fromSeq` — номер первой присланной строки: перекрытие с уже сохранённым сверяется по sha256, разрыв — 409.
 */
export const chatArchiveImportQuerySchema = z.object({
  source: chatArchiveSourceSchema,
  externalId: z.string().trim().min(1).max(200),
  fromSeq: z.coerce.number().int().min(0),
  projectPath: z.string().max(1000).optional()
});
export type ChatArchiveImportQuery = z.infer<typeof chatArchiveImportQuerySchema>;

/** Та же пачка JSON-телом — для инструмента агента (небольшие файлы: общий лимит JSON-тела 2 МБ). */
export const chatArchiveImportBodySchema = chatArchiveImportQuerySchema.extend({
  fromSeq: z.number().int().min(0),
  lines: z.array(z.string()).min(1, "Нет строк для импорта").max(2000)
});
export type ChatArchiveImportBody = z.infer<typeof chatArchiveImportBodySchema>;

export const chatArchiveImportResultSchema = z.object({
  conversation: chatArchiveConversationSchema,
  appended: z.number().int(),
  skipped: z.number().int()
});
export type ChatArchiveImportResult = z.infer<typeof chatArchiveImportResultSchema>;

/** Ответ 204 на удаление: клиентам модуля нужна схема «без тела», а `z` они из контракта не берут. */
export const chatArchiveNoContentSchema = z.void();
