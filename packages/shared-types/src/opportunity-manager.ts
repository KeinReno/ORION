import { z } from "zod";

/**
 * Контракты расширения «ИИ-менеджер» (R1.2): ограниченная автономность в пределах ЯВНО выданной политики.
 * Политика сама ничего не разрешает: каждая отправка проходит те же проверки исполнителя (резервирование, лимит аккаунта,
 * актуальность содержимого). Менеджер не расширяет свои полномочия; срок, лимиты и объём задаёт владелец.
 */

export const MANAGER_LIMITS = { dailyDefault: 3, dailyMax: 20, totalDefault: 10, totalMax: 100, expiryDefaultDays: 7, expiryMaxDays: 30, scoreMin: 50, scoreDefault: 70, tickBatch: 10, grantMinutes: 15 } as const;

export const policyStateSchema = z.enum(["active", "paused", "stopped", "expired"]);
export type PolicyState = z.infer<typeof policyStateSchema>;
export const POLICY_STATE_LABEL: Record<PolicyState, string> = { active: "Действует", paused: "Приостановлена", stopped: "Остановлена", expired: "Срок истёк" };

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Время в формате ЧЧ:ММ");
export const createPolicyInputSchema = z.object({
  connectionId: z.string().uuid(),
  minScore: z.number().int().min(MANAGER_LIMITS.scoreMin).max(100).default(MANAGER_LIMITS.scoreDefault),
  minConfidence: z.enum(["medium", "high"]).default("medium"),
  requiredFactIds: z.array(z.string().uuid()).max(10).default([]).refine((v) => new Set(v).size === v.length, "Повторяющиеся факты"),
  dailyLimit: z.number().int().min(1).max(MANAGER_LIMITS.dailyMax).default(MANAGER_LIMITS.dailyDefault),
  maxTotal: z.number().int().min(1).max(MANAGER_LIMITS.totalMax).default(MANAGER_LIMITS.totalDefault),
  quietHours: z.object({ start: clock, end: clock }).strict().nullable().default(null),
  expiresInDays: z.number().int().min(1).max(MANAGER_LIMITS.expiryMaxDays).default(MANAGER_LIMITS.expiryDefaultDays),
  /** Явное подтверждение: менеджер сам поставит в очередь отправки, не показывая каждый текст на согласование. */
  acknowledgeAutonomy: z.literal(true)
}).strict();
export type CreatePolicyInput = z.infer<typeof createPolicyInputSchema>;
export const policyActionInputSchema = z.object({ expectedRevision: z.number().int().nonnegative(), reason: z.string().trim().max(200).optional() }).strict();
export type PolicyActionInput = z.infer<typeof policyActionInputSchema>;

export const policySchema = z.object({
  id: z.string(), workspaceId: z.string(), connectionId: z.string(), profileId: z.string(), state: policyStateSchema, pausedReason: z.string().nullable(),
  minScore: z.number(), minConfidence: z.enum(["medium", "high"]), requiredFactIds: z.array(z.string()), dailyLimit: z.number(), maxTotal: z.number(), remaining: z.number(),
  quietHours: z.object({ start: z.string(), end: z.string() }).nullable(), timezone: z.string(), expiresAt: z.string(), revision: z.number(), createdAt: z.string(), updatedAt: z.string()
});
export type Policy = z.infer<typeof policySchema>;

export const managerActionStateSchema = z.enum(["queued", "skipped", "needs_review", "failed"]);
export type ManagerActionState = z.infer<typeof managerActionStateSchema>;
export const MANAGER_ACTION_LABEL: Record<ManagerActionState, string> = { queued: "Поставлено в очередь отправки", skipped: "Пропущено", needs_review: "Нужно решение человека", failed: "Ошибка" };
export const managerActionSchema = z.object({
  id: z.string(), policyId: z.string(), opportunityId: z.string(), opportunityTitle: z.string(), state: managerActionStateSchema, reason: z.string(), details: z.array(z.string()),
  attemptId: z.string().nullable(), policyRevision: z.number(), createdAt: z.string()
});
export type ManagerAction = z.infer<typeof managerActionSchema>;

export const tickResultSchema = z.object({
  processed: z.number(), queued: z.number(), skipped: z.number(), needsReview: z.number(), failed: z.number(),
  /** Цикл остановлен до конца: причина (тихие часы, лимит, пауза, неопределённая отправка…). null — разобраны все доступные кандидаты. */
  stoppedReason: z.string().nullable(), actions: z.array(managerActionSchema)
});
export type TickResult = z.infer<typeof tickResultSchema>;

export const policyReportSchema = z.object({
  policy: policySchema, today: z.object({ queued: z.number(), limit: z.number() }),
  totals: z.object({ queued: z.number(), skipped: z.number(), needsReview: z.number(), failed: z.number() }),
  /** Итоги ОТПРАВОК, поставленных этой политикой: сколько подтверждено, не отправлено, ждёт сверки и т. д. */
  attemptsByState: z.record(z.string(), z.number()),
  actions: z.array(managerActionSchema), nextCursor: z.string().nullable()
});
export type PolicyReport = z.infer<typeof policyReportSchema>;
