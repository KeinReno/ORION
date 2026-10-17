import { z } from "zod";

const text = z.string().trim().min(1, "Заполните поле");
export const profilePreferencesSchema = z.object({
  city: z.string().trim().max(200).default(""),
  workFormats: z.array(z.enum(["remote", "hybrid", "office"])).max(3).default([]),
  minSalaryNetRub: z.number().finite().nonnegative().nullable().default(null),
  excludedCompanies: z.array(text.max(200)).max(100).default([]),
  excludedRoles: z.array(text.max(200)).max(100).default([])
}).strict();
const preferencesResponse = z.object({ city: z.string(), workFormats: z.array(z.enum(["remote", "hybrid", "office"])), minSalaryNetRub: z.number().nullable(), excludedCompanies: z.array(z.string()), excludedRoles: z.array(z.string()) });
export const createOpportunityProfileInputSchema = z.object({
  displayName: text.max(200), kind: z.enum(["person", "team"]).default("person"),
  preferences: profilePreferencesSchema.default({}), acknowledgeWorkspaceVisibility: z.literal(true)
}).strict();
export type CreateOpportunityProfileInput = z.infer<typeof createOpportunityProfileInputSchema>;
export const updateOpportunityProfileInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(), displayName: text.max(200).optional(),
  preferences: profilePreferencesSchema.optional(), archivedAt: z.string().datetime().nullable().optional()
}).strict().refine((v) => Object.keys(v).length > 1, "Укажите изменение");
export type UpdateOpportunityProfileInput = z.infer<typeof updateOpportunityProfileInputSchema>;
export const selectOpportunityResumeInputSchema = z.object({ expectedRevision: z.number().int().nonnegative(), materialId: z.string().uuid().nullable() }).strict();
export type SelectOpportunityResumeInput = z.infer<typeof selectOpportunityResumeInputSchema>;
export const opportunityProfileSchema = z.object({
  id: z.string(), workspaceId: z.string(), displayName: z.string(), kind: z.enum(["person", "team"]),
  preferences: preferencesResponse, activeResumeMaterialId: z.string().uuid().nullable(), ownerUserId: z.string(), sourceKey: z.string().nullable(), revision: z.number(),
  archivedAt: z.string().nullable(), createdAt: z.string(), updatedAt: z.string()
});
export type OpportunityProfile = z.infer<typeof opportunityProfileSchema>;
export const opportunityProfilePageSchema = z.object({ items: z.array(opportunityProfileSchema), nextCursor: z.string().nullable() });
export type OpportunityProfilePage = z.infer<typeof opportunityProfilePageSchema>;
export const createOpportunityFactInputSchema = z.object({ statement: text.max(2000), category: text.max(100).default("experience"), source: text.max(1000) }).strict();
export type CreateOpportunityFactInput = z.infer<typeof createOpportunityFactInputSchema>;
export const setOpportunityFactStateInputSchema = z.object({ expectedRevision: z.number().int().nonnegative(), state: z.enum(["confirmed", "disputed", "unverified"]) }).strict();
export type SetOpportunityFactStateInput = z.infer<typeof setOpportunityFactStateInputSchema>;
export const updateOpportunityFactInputSchema = z.object({ expectedRevision: z.number().int().nonnegative(), statement: text.max(2000).optional(), category: text.max(100).optional(), source: text.max(1000).optional() })
  .strict().refine((v) => Object.keys(v).length > 1, "Укажите изменение");
export type UpdateOpportunityFactInput = z.infer<typeof updateOpportunityFactInputSchema>;
/** Архив факта/трека: данные и история остаются, возврат — `archived: false`. */
export const archiveOpportunityItemInputSchema = z.object({ expectedRevision: z.number().int().nonnegative(), archived: z.boolean() }).strict();
export type ArchiveOpportunityItemInput = z.infer<typeof archiveOpportunityItemInputSchema>;
export const updateOpportunityTrackInputSchema = z.object({ expectedRevision: z.number().int().nonnegative(), name: text.max(200).optional(), factIds: z.array(z.string().uuid()).max(100).refine((v) => new Set(v).size === v.length, "Повторяющиеся факты").optional() })
  .strict().refine((v) => Object.keys(v).length > 1, "Укажите изменение");
export type UpdateOpportunityTrackInput = z.infer<typeof updateOpportunityTrackInputSchema>;
export const opportunityFactSchema = z.object({ id: z.string(), profileId: z.string(), statement: z.string(), category: z.string(), source: z.string(), state: z.enum(["unverified", "confirmed", "disputed"]), revision: z.number(), confirmedBy: z.string().nullable(), confirmedAt: z.string().nullable(), archivedAt: z.string().nullable(), createdAt: z.string() });
export type OpportunityFact = z.infer<typeof opportunityFactSchema>;
export const createOpportunityTrackInputSchema = z.object({ name: text.max(200), factIds: z.array(z.string().uuid()).max(100).default([]).refine((v) => new Set(v).size === v.length, "Повторяющиеся факты") }).strict();
export type CreateOpportunityTrackInput = z.infer<typeof createOpportunityTrackInputSchema>;
export const opportunityTrackSchema = z.object({ id: z.string(), profileId: z.string(), name: z.string(), factIds: z.array(z.string()), sourceKey: z.string(), revision: z.number(), archivedAt: z.string().nullable(), createdAt: z.string() });
export type OpportunityTrack = z.infer<typeof opportunityTrackSchema>;
export const createOpportunityMaterialInputSchema = z.object({ title: text.max(300), type: z.enum(["resume", "portfolio", "proposal"]).default("resume"), content: text.max(50000), trackId: z.string().uuid().nullable().default(null) }).strict();
export type CreateOpportunityMaterialInput = z.infer<typeof createOpportunityMaterialInputSchema>;
export const opportunityMaterialSchema = z.object({ id: z.string(), profileId: z.string(), trackId: z.string().nullable(), title: z.string(), type: z.enum(["resume", "portfolio", "proposal"]), contentHash: z.string(), sourcePath: z.string().nullable(), sourceKey: z.string(), createdAt: z.string() });
export type OpportunityMaterial = z.infer<typeof opportunityMaterialSchema>;
export const opportunityMaterialContentSchema = opportunityMaterialSchema.extend({ content: z.string() });
export const opportunityMaterialPageSchema = z.object({ items: z.array(opportunityMaterialSchema), nextCursor: z.string().nullable() });
export const opportunityProfileDetailSchema = opportunityProfileSchema.extend({ activeResume: opportunityMaterialSchema.nullable(), facts: z.array(opportunityFactSchema), tracks: z.array(opportunityTrackSchema), materials: opportunityMaterialPageSchema });
export type OpportunityProfileDetail = z.infer<typeof opportunityProfileDetailSchema>;
