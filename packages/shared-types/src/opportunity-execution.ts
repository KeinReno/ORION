import { z } from "zod";
import { dryRunSchema } from "./opportunity-assistant";

/**
 * Контракты расширения «Отправка» (R1.1) и протокола локального исполнителя `opportunities-executor/v1`.
 *
 * Принципы: сохранённый черновик, разрешение на отправку и подтверждённая отправка — РАЗНЫЕ состояния;
 * разрешение привязано к хэшу точного содержимого; неопределённый результат (`sent_unconfirmed`) никогда
 * не повторяется автоматически; доказательства подтверждения связаны с аккаунтом, получателем и временем.
 */

export const EXECUTOR_CONTRACT_VERSION = "opportunities-executor/v1";
export const EXECUTION_LIMITS = { dailyDefault: 5, dailyMax: 20, minIntervalDefaultSec: 180, minIntervalMinSec: 60, minIntervalMaxSec: 3600, leaseSec: 60, heartbeatSec: 15, grantMinMinutes: 5, grantMaxMinutes: 120, grantDefaultMinutes: 30, failuresToPause: 3, pairingMinutes: 15 } as const;

/* ---------- Подключение ---------- */

export const connectionStateSchema = z.enum(["pending_link", "linked", "paused", "revoked"]);
export type ConnectionState = z.infer<typeof connectionStateSchema>;
export const CONNECTION_STATE_LABEL: Record<ConnectionState, string> = { pending_link: "Ждёт локальный исполнитель", linked: "Подключён", paused: "Приостановлен", revoked: "Отозван" };

export const connectionSchema = z.object({
  id: z.string(), workspaceId: z.string(), profileId: z.string(), provider: z.literal("hh"), accountLabel: z.string(),
  externalAccountId: z.string().nullable(), accountDisplay: z.string().nullable(), state: connectionStateSchema, pausedReason: z.string().nullable(),
  dailyLimit: z.number(), minIntervalSec: z.number(), timezone: z.string(), consecutiveFailures: z.number(),
  /** Последний контакт исполнителя; null — исполнитель не выходил на связь. Отсутствие связи не равно «выполняется». */
  runnerSeenAt: z.string().nullable(), runnerOnline: z.boolean(), linkedAt: z.string().nullable(), revision: z.number(), createdAt: z.string()
});
export type Connection = z.infer<typeof connectionSchema>;

const timezoneSchema = z.string().max(60).refine((tz) => { try { new Intl.DateTimeFormat("ru-RU", { timeZone: tz }); return true; } catch { return false; } }, "Неизвестный часовой пояс");
export const createConnectionInputSchema = z.object({
  profileId: z.string().uuid(), accountLabel: z.string().trim().min(1).max(120),
  dailyLimit: z.number().int().min(1).max(EXECUTION_LIMITS.dailyMax).default(EXECUTION_LIMITS.dailyDefault),
  minIntervalSec: z.number().int().min(EXECUTION_LIMITS.minIntervalMinSec).max(EXECUTION_LIMITS.minIntervalMaxSec).default(EXECUTION_LIMITS.minIntervalDefaultSec),
  timezone: timezoneSchema.default("Europe/Moscow")
}).strict();
export type CreateConnectionInput = z.infer<typeof createConnectionInputSchema>;
export const createdConnectionSchema = connectionSchema.extend({ pairingCode: z.string(), pairingExpiresAt: z.string() });
export type CreatedConnection = z.infer<typeof createdConnectionSchema>;
export const connectionActionInputSchema = z.object({ expectedRevision: z.number().int().nonnegative(), reason: z.string().trim().max(200).optional() }).strict();
export type ConnectionActionInput = z.infer<typeof connectionActionInputSchema>;

/* ---------- Попытка ---------- */

export const attemptStateSchema = z.enum(["awaiting_approval", "queued", "running", "confirmed", "rejected", "canceled", "failed_before_send", "sent_unconfirmed", "already_exists", "needs_user_action"]);
export type AttemptState = z.infer<typeof attemptStateSchema>;
export const ATTEMPT_STATE_LABEL: Record<AttemptState, string> = {
  awaiting_approval: "Ждёт согласования", queued: "Согласовано, ждёт исполнителя", running: "Выполняется", confirmed: "Отправка подтверждена",
  rejected: "Отклонено", canceled: "Отменено", failed_before_send: "Не отправлено (ошибка до отправки)", sent_unconfirmed: "Отправка не подтверждена — нужна сверка",
  already_exists: "Отклик уже существовал", needs_user_action: "Нужно действие человека"
};
export const TERMINAL_ATTEMPT_STATES: AttemptState[] = ["confirmed", "rejected", "canceled", "failed_before_send", "already_exists", "needs_user_action"];

export const evidenceSchema = z.object({
  kind: z.enum(["event_id", "message_id", "ui_transition", "screenshot_hash", "baseline", "owner_attested", "note"]),
  at: z.string().datetime(), accountId: z.string().max(120).optional(), recipientExternalId: z.string().max(120).optional(),
  ref: z.string().max(200).optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), text: z.string().max(500).optional()
}).strict();
export type Evidence = z.infer<typeof evidenceSchema>;
/** Только эти виды, привязанные к аккаунту и получателю, могут подтвердить отправку. Скриншот или текст сами по себе — нет. */
export const CONFIRMING_EVIDENCE_KINDS: Evidence["kind"][] = ["event_id", "message_id", "ui_transition"];

export const attemptPayloadSchema = dryRunSchema.shape.payload;
export const attemptSchema = z.object({
  id: z.string(), workspaceId: z.string(), opportunityId: z.string(), profileId: z.string(), connectionId: z.string(), draftId: z.string(),
  actionType: z.literal("apply"), idempotencyKey: z.string(), state: attemptStateSchema, payload: attemptPayloadSchema, payloadHash: z.string(),
  reviewNotes: z.array(z.string()), reviewAcknowledged: z.boolean(),
  grant: z.object({ state: z.enum(["none", "active", "consumed", "revoked", "expired"]), expiresAt: z.string().nullable(), grantedBy: z.string().nullable() }),
  /** Содержимое/резюме/адресат изменились после создания: прежнее согласование не действует. Вычисляется на чтении. */
  invalidated: z.boolean(), invalidReasons: z.array(z.string()),
  /** Кто поставил отправку в очередь: null — владелец вручную, иначе ссылка на политику менеджера. */
  initiatedBy: z.string().nullable(),
  cancelRequested: z.boolean(), submitReserved: z.boolean(), claimCount: z.number(), leaseExpiresAt: z.string().nullable(),
  evidence: z.array(evidenceSchema), confirmationBasis: z.enum(["runner_observed", "owner_attested"]).nullable(),
  errorCode: z.string().nullable(), message: z.string().nullable(),
  timeline: z.array(z.object({ at: z.string(), state: z.string(), note: z.string() })),
  revision: z.number(), createdBy: z.string(), createdAt: z.string(), updatedAt: z.string(), completedAt: z.string().nullable()
});
export type Attempt = z.infer<typeof attemptSchema>;
export const attemptPageSchema = z.object({ items: z.array(attemptSchema), nextCursor: z.string().nullable() });

export const createAttemptInputSchema = z.object({ draftId: z.string().uuid(), connectionId: z.string().uuid(), idempotencyKey: z.string().trim().min(8).max(80) }).strict();
export type CreateAttemptInput = z.infer<typeof createAttemptInputSchema>;
export const approveAttemptInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(), payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  ttlMinutes: z.number().int().min(EXECUTION_LIMITS.grantMinMinutes).max(EXECUTION_LIMITS.grantMaxMinutes).default(EXECUTION_LIMITS.grantDefaultMinutes),
  acknowledgeReviewNotes: z.boolean().default(false)
}).strict();
export type ApproveAttemptInput = z.infer<typeof approveAttemptInputSchema>;
export const cancelAttemptInputSchema = z.object({ expectedRevision: z.number().int().nonnegative() }).strict();
export type CancelAttemptInput = z.infer<typeof cancelAttemptInputSchema>;
export const reconcileAttemptInputSchema = z.object({ expectedRevision: z.number().int().nonnegative(), outcome: z.enum(["sent", "not_sent"]), note: z.string().trim().max(500).optional() }).strict();
export type ReconcileAttemptInput = z.infer<typeof reconcileAttemptInputSchema>;

/* ---------- Протокол исполнителя (capability-токен, не пользовательский JWT) ---------- */

export const runnerBindInputSchema = z.object({
  pairingCode: z.string().min(10).max(80), externalAccountId: z.string().trim().min(1).max(120), accountDisplay: z.string().trim().max(200).default(""),
  runnerId: z.string().trim().min(1).max(80), contractVersion: z.literal(EXECUTOR_CONTRACT_VERSION)
}).strict();
export type RunnerBindInput = z.infer<typeof runnerBindInputSchema>;
export const runnerBindResultSchema = z.object({ connectionId: z.string(), runnerToken: z.string(), contractVersion: z.literal(EXECUTOR_CONTRACT_VERSION) });
export type RunnerBindResult = z.infer<typeof runnerBindResultSchema>;

export const runnerJobSchema = z.object({
  attemptId: z.string(), leaseToken: z.string(), leaseExpiresAt: z.string(), heartbeatSec: z.number(), contractVersion: z.literal(EXECUTOR_CONTRACT_VERSION),
  connection: z.object({ id: z.string(), externalAccountId: z.string() }), payload: attemptPayloadSchema, payloadHash: z.string(), grantExpiresAt: z.string()
});
export type RunnerJob = z.infer<typeof runnerJobSchema>;
export const runnerClaimResultSchema = z.object({ job: runnerJobSchema.nullable(), reason: z.string().optional(), retryAfterSec: z.number().optional() });
export type RunnerClaimResult = z.infer<typeof runnerClaimResultSchema>;

export const runnerLeaseInputSchema = z.object({ attemptId: z.string().uuid(), leaseToken: z.string().min(20).max(200) }).strict();
export type RunnerLeaseInput = z.infer<typeof runnerLeaseInputSchema>;
export const runnerHeartbeatResultSchema = z.object({ leaseExpiresAt: z.string(), cancelRequested: z.boolean(), paused: z.boolean(), grantValid: z.boolean() });
export type RunnerHeartbeatResult = z.infer<typeof runnerHeartbeatResultSchema>;

export const runnerReserveInputSchema = runnerLeaseInputSchema.extend({
  observedAccountId: z.string().trim().min(1).max(120),
  /** Исполнитель увидел, что отклик на эту вакансию уже есть, ДО нажатия. Тогда отправки не будет. */
  baselineExists: z.boolean(), baselineEvidence: evidenceSchema.optional()
}).strict();
export type RunnerReserveInput = z.infer<typeof runnerReserveInputSchema>;
export const runnerReserveResultSchema = z.object({ proceed: z.boolean(), reason: z.string().optional(), retryAfterSec: z.number().optional(), state: attemptStateSchema });
export type RunnerReserveResult = z.infer<typeof runnerReserveResultSchema>;

export const runnerOutcomeSchema = z.enum(["confirmed", "already_exists", "failed_before_send", "needs_user_action", "sent_unconfirmed"]);
export const runnerResultInputSchema = runnerLeaseInputSchema.extend({
  outcome: runnerOutcomeSchema, evidence: z.array(evidenceSchema).max(10).default([]),
  errorCode: z.string().max(80).optional(), errorKind: z.enum(["system", "platform", "user_action"]).optional(), message: z.string().max(500).optional()
}).strict();
export type RunnerResultInput = z.infer<typeof runnerResultInputSchema>;
export const runnerResultSchema = z.object({ state: attemptStateSchema, accepted: z.boolean(), reason: z.string().optional() });
export type RunnerResult = z.infer<typeof runnerResultSchema>;
