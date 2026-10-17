import { z } from "zod";

/**
 * Контракты расширения «Ассистент» (R0.3). Оценка и черновик — локальные данные для владельца:
 * они не отправляют ничего во внешний сервис и не дают права на отправку. Пробный запуск всегда `send: false`.
 */

export const ASSESSMENT_RULES_VERSION = "rules-v1";
export const DRAFT_TEMPLATE_VERSION = "template-v1";

export const assessmentVerdictSchema = z.enum(["matched", "partial", "gap", "unknown", "conflict"]);
export type AssessmentVerdict = z.infer<typeof assessmentVerdictSchema>;
export const ASSESSMENT_VERDICT_LABEL: Record<AssessmentVerdict, string> = {
  matched: "Соответствует (подтверждено)", partial: "Частично (подтверждено)", gap: "Пробел",
  unknown: "Неизвестно: есть только непроверенные сведения", conflict: "Противоречие: факт оспорен"
};

/** Основание для оценки: подтверждённый/непроверенный/оспоренный факт либо упоминание в тексте резюме (всегда непроверенное). */
export const evidenceRefSchema = z.object({
  kind: z.enum(["fact", "resume"]), id: z.string(), text: z.string(),
  state: z.enum(["confirmed", "unverified", "disputed"]), source: z.string()
});
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const criterionSchema = z.object({
  id: z.string(), text: z.string(), fragment: z.string(), importance: z.enum(["must", "nice"]),
  verdict: assessmentVerdictSchema, evidence: z.array(evidenceRefSchema), reason: z.string()
});
export type AssessmentCriterion = z.infer<typeof criterionSchema>;

export const conditionCheckSchema = z.object({
  key: z.enum(["workFormat", "salary", "city", "company", "role", "track"]),
  verdict: z.enum(["ok", "mismatch", "unknown", "review"]),
  severity: z.enum(["hard", "none"]), reason: z.string()
});
export type ConditionCheck = z.infer<typeof conditionCheckSchema>;

export const assessmentInputsSchema = z.object({
  opportunityId: z.string(), opportunityRevision: z.number(), profileId: z.string(), profileRevision: z.number(),
  factCount: z.number(), confirmedFactCount: z.number(),
  activeResumeMaterialId: z.string().nullable(), activeResumeHash: z.string().nullable(),
  providerId: z.string(), rulesVersion: z.string(), inputHash: z.string(),
  /** Хэши частей входных данных: по ним видно, ЧТО именно изменилось, когда оценка устарела. */
  components: z.object({ opportunity: z.string(), preferences: z.string(), facts: z.string(), tracks: z.string(), resume: z.string() })
});
export type AssessmentInputs = z.infer<typeof assessmentInputsSchema>;

export const assessmentBreakdownSchema = z.object({
  must: z.object({ weight: z.number(), earned: z.number().nullable(), count: z.number() }),
  conditions: z.object({ weight: z.number(), earned: z.number().nullable(), count: z.number() }),
  track: z.object({ weight: z.number(), earned: z.number().nullable(), count: z.number() }),
  nice: z.object({ weight: z.number(), earned: z.number().nullable(), count: z.number() })
});

export const assessmentSchema = z.object({
  id: z.string(), workspaceId: z.string(), opportunityId: z.string(), profileId: z.string(),
  provider: z.object({ id: z.string(), version: z.string() }),
  score: z.number().nullable(), confidence: z.enum(["low", "medium", "high"]), breakdown: assessmentBreakdownSchema,
  criteria: z.array(criterionSchema), conditions: z.array(conditionCheckSchema),
  /** Чего ассистент не знает: неизвестные условия, нераспознанные требования, нет подтверждённых фактов. */
  unknowns: z.array(z.string()),
  /** Причины, по которым автоматическая отправка по этой оценке невозможна (R1 их учитывает, R0.3 — только показывает). */
  autoSendBlockers: z.array(z.string()),
  inputs: assessmentInputsSchema,
  stale: z.boolean(), staleReasons: z.array(z.string()),
  createdBy: z.string(), createdAt: z.string()
});
export type Assessment = z.infer<typeof assessmentSchema>;
export const assessmentPageSchema = z.object({ items: z.array(assessmentSchema), nextCursor: z.string().nullable() });

export const createAssessmentInputSchema = z.object({
  opportunityId: z.string().uuid(), profileId: z.string().uuid(),
  provider: z.string().max(40).default("rules-v1")
}).strict();
export type CreateAssessmentInput = z.infer<typeof createAssessmentInputSchema>;

/* ---------- Черновики ---------- */

export const draftKindSchema = z.enum(["response", "proposal", "answer"]);
export type DraftKind = z.infer<typeof draftKindSchema>;
export const DRAFT_KIND_LABEL: Record<DraftKind, string> = { response: "Отклик на вакансию", proposal: "Предложение по заказу", answer: "Ответ на вопрос" };

/** Основание раздела: template — служебный текст без утверждений; confirmed — опирается на подтверждённые факты; unverified — есть непроверенные факты; manual — изменён вручную; empty — нет подтверждённых сведений. */
export const draftSectionBasisSchema = z.enum(["template", "confirmed", "unverified", "manual", "empty"]);
export type DraftSectionBasis = z.infer<typeof draftSectionBasisSchema>;
export const DRAFT_BASIS_LABEL: Record<DraftSectionBasis, string> = {
  template: "Служебный текст", confirmed: "Опирается на подтверждённые факты", unverified: "Есть непроверенные факты",
  manual: "Изменено вручную: проверьте достоверность", empty: "Нет подтверждённых сведений — напишите сами"
};

export const draftSectionInputSchema = z.object({ id: z.string().min(1).max(40), text: z.string().max(4000), factIds: z.array(z.string().uuid()).max(10) }).strict();
export const draftSectionSchema = z.object({
  id: z.string(), text: z.string(), factIds: z.array(z.string()), origin: z.enum(["template", "generated", "manual"]),
  basis: draftSectionBasisSchema, requirementId: z.string().nullable(), hint: z.string()
});
export type DraftSection = z.infer<typeof draftSectionSchema>;

export const materialRefSchema = z.object({ id: z.string(), title: z.string(), type: z.string(), contentHash: z.string() });
export type MaterialRef = z.infer<typeof materialRefSchema>;

export const draftSchema = z.object({
  id: z.string(), workspaceId: z.string(), opportunityId: z.string(), profileId: z.string(), assessmentId: z.string().nullable(),
  kind: draftKindSchema, question: z.string().nullable(), sections: z.array(draftSectionSchema),
  /** Для справки владельцу: пробелы и неизвестное. В текст отклика НЕ попадают. */
  notes: z.array(z.string()),
  text: z.string(), textHash: z.string(), materials: z.array(materialRefSchema),
  reviewState: z.enum(["draft", "approved", "rejected"]), approvedBy: z.string().nullable(), approvedAt: z.string().nullable(),
  /** approved и текст/основания не менялись: проверяется на чтении, не хранится. */
  approvalValid: z.boolean(),
  blockers: z.array(z.string()),
  stale: z.boolean(), staleReasons: z.array(z.string()),
  templateVersion: z.string(), revision: z.number(), createdBy: z.string(), createdAt: z.string(), updatedAt: z.string()
});
export type Draft = z.infer<typeof draftSchema>;
export const draftPageSchema = z.object({ items: z.array(draftSchema), nextCursor: z.string().nullable() });

export const createDraftInputSchema = z.object({
  opportunityId: z.string().uuid(), profileId: z.string().uuid(), kind: draftKindSchema,
  question: z.string().trim().min(3).max(1000).optional()
}).strict().refine((v) => (v.kind === "answer") === (v.question !== undefined), "Вопрос нужен для ответа и только для него");
export type CreateDraftInput = z.infer<typeof createDraftInputSchema>;

export const updateDraftInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  sections: z.array(draftSectionInputSchema).min(1).max(30).refine((v) => new Set(v.map((s) => s.id)).size === v.length, "Повторяющиеся разделы")
}).strict();
export type UpdateDraftInput = z.infer<typeof updateDraftInputSchema>;

export const reviewDraftInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  /** Хэш текста, который видел владелец: одобрение привязано к нему. */
  textHash: z.string().regex(/^[a-f0-9]{64}$/),
  acknowledgeManualSections: z.boolean().default(false)
}).strict();
export type ReviewDraftInput = z.infer<typeof reviewDraftInputSchema>;
export const rejectDraftInputSchema = z.object({ expectedRevision: z.number().int().nonnegative() }).strict();
export type RejectDraftInput = z.infer<typeof rejectDraftInputSchema>;

export const dryRunSchema = z.object({
  mode: z.literal("dry_run"), send: z.literal(false),
  payload: z.object({
    recipient: z.object({ opportunityId: z.string(), title: z.string(), organizationName: z.string(), url: z.string().nullable(), sourceType: z.string(), externalId: z.string().nullable() }),
    profile: z.object({ id: z.string(), displayName: z.string() }),
    text: z.string(), materials: z.array(materialRefSchema)
  }),
  payloadHash: z.string(),
  /** Без их устранения отправка невозможна даже по ручному согласованию: черновик устарел/не одобрен, пустые разделы, нет резюме. */
  blockers: z.array(z.string()),
  /** Что владелец должен осознанно принять при ручном согласовании (непроверенные требования, жёсткие ограничения профиля). Автономный режим по ним не работает. */
  reviewNotes: z.array(z.string()),
  note: z.string()
});
export type DryRun = z.infer<typeof dryRunSchema>;

export const assistantStatusSchema = z.object({
  providers: z.array(z.object({ id: z.string(), label: z.string(), available: z.boolean(), sendsDataExternally: z.boolean(), reason: z.string() })),
  externalSend: z.literal(false)
});
export type AssistantStatus = z.infer<typeof assistantStatusSchema>;
