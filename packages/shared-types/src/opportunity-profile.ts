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
export const opportunityProfileSchema = z.object({
  id: z.string(), workspaceId: z.string(), displayName: z.string(), kind: z.enum(["person", "team"]),
  preferences: preferencesResponse, ownerUserId: z.string(), sourceKey: z.string().nullable(), revision: z.number(),
  archivedAt: z.string().nullable(), createdAt: z.string(), updatedAt: z.string()
});
export type OpportunityProfile = z.infer<typeof opportunityProfileSchema>;
export const opportunityProfilePageSchema = z.object({ items: z.array(opportunityProfileSchema), nextCursor: z.string().nullable() });
export type OpportunityProfilePage = z.infer<typeof opportunityProfilePageSchema>;
export const createOpportunityFactInputSchema = z.object({ statement: text.max(2000), category: text.max(100).default("experience"), source: text.max(1000) }).strict();
export type CreateOpportunityFactInput = z.infer<typeof createOpportunityFactInputSchema>;
export const setOpportunityFactStateInputSchema = z.object({ expectedRevision: z.number().int().nonnegative(), state: z.enum(["confirmed", "disputed", "unverified"]) }).strict();
export type SetOpportunityFactStateInput = z.infer<typeof setOpportunityFactStateInputSchema>;
export const opportunityFactSchema = z.object({ id: z.string(), profileId: z.string(), statement: z.string(), category: z.string(), source: z.string(), state: z.enum(["unverified", "confirmed", "disputed"]), revision: z.number(), confirmedBy: z.string().nullable(), confirmedAt: z.string().nullable(), createdAt: z.string() });
export type OpportunityFact = z.infer<typeof opportunityFactSchema>;
export const createOpportunityTrackInputSchema = z.object({ name: text.max(200), factIds: z.array(z.string().uuid()).max(100).default([]).refine((v) => new Set(v).size === v.length, "Повторяющиеся факты") }).strict();
export type CreateOpportunityTrackInput = z.infer<typeof createOpportunityTrackInputSchema>;
export const opportunityTrackSchema = z.object({ id: z.string(), profileId: z.string(), name: z.string(), factIds: z.array(z.string()), sourceKey: z.string(), createdAt: z.string() });
export const createOpportunityMaterialInputSchema = z.object({ title: text.max(300), type: z.enum(["resume", "portfolio", "proposal"]).default("resume"), content: text.max(50000), trackId: z.string().uuid().nullable().default(null) }).strict();
export type CreateOpportunityMaterialInput = z.infer<typeof createOpportunityMaterialInputSchema>;
export const opportunityMaterialSchema = z.object({ id: z.string(), profileId: z.string(), trackId: z.string().nullable(), title: z.string(), type: z.enum(["resume", "portfolio", "proposal"]), contentHash: z.string(), sourcePath: z.string().nullable(), sourceKey: z.string(), createdAt: z.string() });
export type OpportunityMaterial = z.infer<typeof opportunityMaterialSchema>;
export const opportunityMaterialContentSchema = opportunityMaterialSchema.extend({ content: z.string() });
export const opportunityMaterialPageSchema = z.object({ items: z.array(opportunityMaterialSchema), nextCursor: z.string().nullable() });
export const opportunityProfileDetailSchema = opportunityProfileSchema.extend({ facts: z.array(opportunityFactSchema), tracks: z.array(opportunityTrackSchema), materials: opportunityMaterialPageSchema });
export type OpportunityProfileDetail = z.infer<typeof opportunityProfileDetailSchema>;
