import { z } from "zod";

export const opportunityKindSchema = z.enum(["job", "contract"]);
export const opportunityStatusSchema = z.enum(["new", "reviewing", "shortlisted", "in_contact", "interview_or_discussion", "offer_or_agreement", "won", "rejected", "closed"]);
export type OpportunityStatus = z.infer<typeof opportunityStatusSchema>;
export const OPPORTUNITY_STATUS_LABEL: Record<OpportunityStatus, string> = {
  new: "Новая", reviewing: "Изучение", shortlisted: "Подходит", in_contact: "Переписка",
  interview_or_discussion: "Обсуждение", offer_or_agreement: "Согласование", won: "Получена", rejected: "Отказ", closed: "Закрыта"
};
const publicUrl = z.string().trim().max(2000).url().refine((value) => /^https?:\/\//i.test(value), "Используйте ссылку HTTP или HTTPS");
export const opportunityConditionsSchema = z.object({
  workFormat: z.enum(["remote", "hybrid", "office", "unknown"]).default("unknown"),
  city: z.string().trim().max(200).default(""),
  amountMin: z.number().finite().nonnegative().nullable().default(null),
  amountMax: z.number().finite().nonnegative().nullable().default(null),
  currency: z.string().regex(/^[A-Z]{3}$/).default("RUB"),
  paymentBasis: z.enum(["monthly", "hourly", "fixed", "unknown"]).default("unknown"),
  taxBasis: z.enum(["net", "gross", "unknown"]).default("unknown"),
  deadline: z.string().datetime().nullable().default(null)
}).strict().refine((value) => value.amountMin === null || value.amountMax === null || value.amountMax >= value.amountMin, "Верхняя граница суммы меньше нижней");
const fields = {
  kind: opportunityKindSchema,
  title: z.string().trim().min(1, "Название обязательно").max(300),
  organizationName: z.string().trim().max(300).default(""),
  description: z.string().max(50_000).default(""),
  sourceType: z.string().trim().min(1).max(80).default("manual"),
  canonicalUrl: publicUrl.nullable().default(null),
  externalId: z.string().trim().min(1).max(200).nullable().default(null),
  status: opportunityStatusSchema.default("new"),
  conditions: opportunityConditionsSchema.default({}),
  capturedAt: z.string().datetime().nullable().default(null)
};
export const createOpportunityInputSchema = z.object(fields).strict();
export type CreateOpportunityInput = z.infer<typeof createOpportunityInputSchema>;
export const updateOpportunityInputSchema = z.object(fields).partial().extend({
  expectedRevision: z.number().int().nonnegative(),
  archivedAt: z.string().datetime().nullable().optional()
}).strict().refine((value) => Object.keys(value).some((key) => key !== "expectedRevision"), "Укажите изменение");
export type UpdateOpportunityInput = z.infer<typeof updateOpportunityInputSchema>;
export const opportunityHistoryEntrySchema = z.object({
  at: z.string(), actorId: z.string(), action: z.enum(["created", "updated", "archived", "restored"]),
  fromStatus: opportunityStatusSchema.nullable(), toStatus: opportunityStatusSchema
});
export const opportunitySchema = z.object(fields).extend({
  organizationName: z.string(), description: z.string(), sourceType: z.string(),
  canonicalUrl: publicUrl.nullable(), externalId: z.string().nullable(), status: opportunityStatusSchema,
  capturedAt: z.string().nullable(),
  conditions: z.object({ workFormat: z.enum(["remote", "hybrid", "office", "unknown"]), city: z.string(),
    amountMin: z.number().nullable(), amountMax: z.number().nullable(), currency: z.string(),
    paymentBasis: z.enum(["monthly", "hourly", "fixed", "unknown"]), taxBasis: z.enum(["net", "gross", "unknown"]), deadline: z.string().nullable() }),
  id: z.string(), workspaceId: z.string(), revision: z.number().int().nonnegative(),
  archivedAt: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(),
  history: z.array(opportunityHistoryEntrySchema)
});
export type Opportunity = z.infer<typeof opportunitySchema>;
export const opportunityPageSchema = z.object({ items: z.array(opportunitySchema), nextCursor: z.string().nullable() });
export type OpportunityPage = z.infer<typeof opportunityPageSchema>;
export const opportunityListQuerySchema = z.object({
  query: z.string().trim().max(300).optional(), kind: opportunityKindSchema.optional(),
  status: opportunityStatusSchema.optional(), includeArchived: z.enum(["true", "false"]).optional(),
  cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(50)
}).strict();
export type OpportunityListQuery = z.infer<typeof opportunityListQuerySchema>;
