import { z } from "zod";

/**
 * Чат-ассистент внутри ORION (ADR-0017, вариант C): язык модели вызывается по ключу владельца, а действия ассистента
 * идут через те же `/ai/v1`-инструменты, что и у внешних агентов (режим «помощник», удаление — только запросом, финансы —
 * только чтение). Отвечать может и программа по подписке на этом компьютере (Codex, Cursor) — см. `ASSISTANT_ENGINES`.
 * Схемы ответов без `.default(...)`.
 */
export const ASSISTANT_DEFAULT_MODEL = "claude-sonnet-5-5";

export const assistantKeyStatusSchema = z.object({
  /** Ключ сохранён. Сам ключ наружу не отдаётся никогда. */
  configured: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  /** Можно ли хранить ключ на этом узле (нужен `SYNC_SECRET`) и включён ли мост агентов. */
  available: z.boolean(),
  /** Почему недоступно, по-русски; `null`, если доступно. */
  reason: z.string().nullable()
});
export type AssistantKeyStatus = z.infer<typeof assistantKeyStatusSchema>;

export const setAssistantKeyInputSchema = z.object({
  apiKey: z.string().trim().min(20, "Ключ слишком короткий").max(400, "Ключ слишком длинный"),
  model: z.string().trim().min(1).max(80).default(ASSISTANT_DEFAULT_MODEL)
});
export type SetAssistantKeyInput = z.input<typeof setAssistantKeyInputSchema>;

/** Models offered in the picker (any other id can still be typed); the first is the default. */
export const ASSISTANT_MODELS: ReadonlyArray<{ id: string; label: string; hint: string }> = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "баланс качества и цены — для повседневного чата" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "самая сильная, дороже — для сложных просьб" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", hint: "самая быстрая и дешёвая" }
];

/**
 * Who answers in the assistant's chat: the model by the user's own Anthropic key, or a program installed on THIS computer
 * that the user already pays for (Codex, Cursor) — ORION runs it for one answer with a short-lived token and its MCP
 * server, exactly as when that program is connected in «ИИ и агенты». Only in a local ORION.
 */
export const ASSISTANT_ENGINES = ["anthropic", "codex", "cursor"] as const;
export const assistantEngineSchema = z.enum(ASSISTANT_ENGINES);
export type AssistantEngine = z.infer<typeof assistantEngineSchema>;

export const ASSISTANT_ENGINE_LABEL: Record<AssistantEngine, string> = {
  anthropic: "Свой ключ Anthropic",
  codex: "Codex (подписка ChatGPT)",
  cursor: "Cursor (подписка Cursor)"
};

export const assistantEngineStatusSchema = z.object({
  engine: assistantEngineSchema,
  label: z.string(),
  available: z.boolean(),
  /** Why it cannot answer now, in Russian; `null` when it can. */
  reason: z.string().nullable(),
  /** How to make it available (install, sign in) — shown next to the reason. */
  hint: z.string().nullable()
});
export type AssistantEngineStatus = z.infer<typeof assistantEngineStatusSchema>;

/** Change only the model; the stored key stays as it is. */
export const setAssistantModelInputSchema = z.object({ model: z.string().trim().min(1).max(80) });
export type SetAssistantModelInput = z.infer<typeof setAssistantModelInputSchema>;

export const assistantMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000)
});
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;

export const assistantChatInputSchema = z.object({
  messages: z.array(assistantMessageSchema).min(1).max(30)
});
export type AssistantChatInput = z.infer<typeof assistantChatInputSchema>;

export const assistantActionSchema = z.object({
  tool: z.string(),
  ok: z.boolean(),
  /** Короткий итог вызова: что вернул ORION (или причина отказа). */
  summary: z.string(),
  /** Изменение ждёт подтверждения: id запроса — чат показывает «Применить / Отклонить» прямо в ответе. */
  proposalId: z.string().nullable()
});
export type AssistantAction = z.infer<typeof assistantActionSchema>;

export const assistantChatResultSchema = z.object({
  reply: z.string(),
  actions: z.array(assistantActionSchema),
  inputTokens: z.number().int(),
  outputTokens: z.number().int()
});
export type AssistantChatResult = z.infer<typeof assistantChatResultSchema>;

// ── Беседы (история чата) ─────────────────────────────────────────────────────────────────────────
/** Stored messages per conversation (older ones drop off); the model sees the last ASSISTANT_CONTEXT_MESSAGES. */
export const ASSISTANT_HISTORY_MAX = 200;
export const ASSISTANT_CONTEXT_MESSAGES = 30;

/** What a stored message keeps about its files (no picture bytes). */
export const assistantStoredAttachmentSchema = z.object({ documentId: z.string(), name: z.string(), mimeType: z.string(), sizeBytes: z.number().int() });
export type AssistantStoredAttachment = z.infer<typeof assistantStoredAttachmentSchema>;

export const assistantStoredMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  /** What the assistant did in ORION while answering (empty for the user's own messages). */
  actions: z.array(assistantActionSchema),
  at: z.string(),
  /** The answer hit the length limit and was cut. */
  truncated: z.boolean(),
  /** Files the user sent with this message. Absent in messages saved before attachments existed. */
  attachments: z.array(assistantStoredAttachmentSchema).optional(),
  /** Who answered (absent = the Anthropic key, as before engines existed). */
  engine: assistantEngineSchema.optional()
});
export type AssistantStoredMessage = z.infer<typeof assistantStoredMessageSchema>;

export const assistantConversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  messageCount: z.number().int(),
  updatedAt: z.string()
});
export type AssistantConversationSummary = z.infer<typeof assistantConversationSummarySchema>;

export const assistantConversationSchema = assistantConversationSummarySchema.extend({
  messages: z.array(assistantStoredMessageSchema)
});
export type AssistantConversation = z.infer<typeof assistantConversationSchema>;

/**
 * What the user is looking at when they write («эта задача», «этот проект»): the active section and, when one is open,
 * the record. UI text, so the server treats it as data in the prompt, never as instructions.
 */
export const assistantViewContextSchema = z.object({
  panel: z.string().trim().max(80),
  label: z.string().trim().max(120),
  entityType: z.string().trim().max(40).nullable(),
  entityId: z.string().trim().max(80).nullable(),
  title: z.string().trim().max(300).nullable()
});
export type AssistantViewContext = z.infer<typeof assistantViewContextSchema>;

/** Image formats the model can look at; the client downsizes photos to ≤ 1568 px before sending. */
export const ASSISTANT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

/**
 * A file the user attached: already saved in «Документы → Ассистент — входящие» (`documentId`); `excerpt` is the start of
 * its extracted text, `image` the downsized picture itself (base64) so the model can see it.
 */
export const assistantAttachmentInputSchema = z.object({
  documentId: z.string().min(1).max(80),
  name: z.string().max(260),
  mimeType: z.string().max(160),
  sizeBytes: z.number().int().min(0),
  excerpt: z.string().max(4000).default(""),
  image: z.object({ mediaType: z.enum(ASSISTANT_IMAGE_TYPES), data: z.string().max(1_500_000) }).optional()
});
export type AssistantAttachmentInput = z.infer<typeof assistantAttachmentInputSchema>;

export const assistantSendInputSchema = z.object({
  /** null/absent — start a new conversation. */
  conversationId: z.string().min(1).nullable().optional(),
  /** Text; may be empty when files say it all («вот скан, разберись»). */
  message: z.string().trim().max(8000),
  context: assistantViewContextSchema.nullable().optional(),
  attachments: z.array(assistantAttachmentInputSchema).max(10).default([]),
  engine: assistantEngineSchema.default("anthropic")
}).refine((value) => value.message.length > 0 || value.attachments.length > 0, { message: "Пустое сообщение", path: ["message"] });
export type AssistantSendInput = z.input<typeof assistantSendInputSchema>;

export const assistantSendResultSchema = assistantChatResultSchema.extend({
  conversationId: z.string(),
  title: z.string(),
  truncated: z.boolean()
});
export type AssistantSendResult = z.infer<typeof assistantSendResultSchema>;
