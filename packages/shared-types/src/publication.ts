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
