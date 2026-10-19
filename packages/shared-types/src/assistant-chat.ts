import { z } from "zod";

/**
 * Чат-ассистент внутри ORION (ADR-0017, вариант C): язык модели вызывается по ключу владельца, а действия ассистента
 * идут через те же `/ai/v1`-инструменты, что и у внешних агентов (режим «помощник», без удаления и финансов).
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
  summary: z.string()
});
export type AssistantAction = z.infer<typeof assistantActionSchema>;

export const assistantChatResultSchema = z.object({
  reply: z.string(),
  actions: z.array(assistantActionSchema),
  inputTokens: z.number().int(),
  outputTokens: z.number().int()
});
export type AssistantChatResult = z.infer<typeof assistantChatResultSchema>;
