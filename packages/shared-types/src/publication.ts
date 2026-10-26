import { z } from "zod";
import { taskStatusSchema } from "./task";

export const publicationKindSchema = z.enum(["task", "knowledge"]);
export type PublicationKind = z.infer<typeof publicationKindSchema>;
export const publicationContentSchema = z.object({
  title: z.string().min(1).max(300), text: z.string().max(100000),
  status: taskStatusSchema.optional(), dueAt: z.string().datetime().nullable().optional()
}).strict();
export type PublicationContent = z.infer<typeof publicationContentSchema>;
export const publicationSourceSchema = z.object({
  sourceWorkspaceId: z.string().uuid(), sourceId: z.string().uuid(), kind: publicationKindSchema,
  includeText: z.boolean().default(false), includeDueAt: z.boolean().default(false)
}).strict();
export type PublicationSource = z.infer<typeof publicationSourceSchema>;
export const publicationPreviewSchema = z.object({ content: publicationContentSchema, sourceRevision: z.number().int(), fingerprint: z.string() });
export type PublicationPreview = z.infer<typeof publicationPreviewSchema>;
export const createPublicationSchema = publicationSourceSchema.extend({
  workspaceId: z.string().uuid(), allowStatus: z.boolean().default(false), fingerprint: z.string().length(64)
}).strict();
export type CreatePublication = z.infer<typeof createPublicationSchema>;
export const sharedPublicationSchema = z.object({
  id: z.string().uuid(), workspaceId: z.string().uuid(), kind: publicationKindSchema,
  content: publicationContentSchema, revision: z.number().int(), allowStatus: z.boolean(),
  canManage: z.boolean(), createdAt: z.string(), updatedAt: z.string()
});
export type SharedPublication = z.infer<typeof sharedPublicationSchema>;
export const publicationStatusInputSchema = z.object({
  operationId: z.string().uuid(), expectedRevision: z.number().int().positive(), status: taskStatusSchema
}).strict();
export type PublicationStatusInput = z.infer<typeof publicationStatusInputSchema>;
export const publicationDestinationSchema = z.object({ workspaceId: z.string().uuid() }).strict();
export const publicationCopySchema = z.object({ workspaceId: z.string().uuid(), id: z.string().uuid(), kind: publicationKindSchema });

export const publicationRefreshSchema = z.object({ expectedRevision: z.number().int().positive(), fingerprint: z.string().length(64) }).strict();


// Rules are owner-only configuration; never included in recipient publication DTOs.
export const publicationRuleConfigSchema = z.object({
  sourceWorkspaceId: z.string().uuid(), workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  projectIds: z.array(z.string().uuid()).max(20).default([]),
  statuses: z.array(taskStatusSchema).max(10).default([]),
  includeText: z.boolean().default(false), includeDueAt: z.boolean().default(false),
  allowStatus: z.boolean().default(false)
}).strict().refine(v => v.sourceWorkspaceId !== v.workspaceId, { message: "Выберите отдельную общую зону" });
export type PublicationRuleConfig = z.infer<typeof publicationRuleConfigSchema>;
export const publicationRuleRevisionSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();
export const publicationRuleEnableSchema = publicationRuleRevisionSchema.extend({
  fingerprint: z.string().length(64), consentFutureRecords: z.literal(true)
}).strict();
export type PublicationRuleEnable = z.infer<typeof publicationRuleEnableSchema>;
export const publicationRuleEditSchema = z.object({
  expectedRevision: z.number().int().positive(), config: publicationRuleConfigSchema
}).strict();
export interface PublicationRule {
  id: string; config: PublicationRuleConfig; enabled: boolean; revision: number;
  lastRunAt: string | null; lastError: string | null;
  history: Array<{ at: string; action: string; fingerprint?: string; consentFutureRecords?: boolean; published?: number; updated?: number; withdrawn?: number }>;
}
export interface PublicationRulePreview {
  count: number; publishableCount: number; items: Array<{ sourceId: string; content: PublicationContent; action: "publish" | "update" | "excluded" }>;
  recipients: Array<{ userId: string; role: string }>; fingerprint: string;
}
