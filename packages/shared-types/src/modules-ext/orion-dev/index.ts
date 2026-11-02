import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const developmentReviewInputSchema = z.object({
  workspaceConfirmed: z.literal(true), previewDigest: digest,
  choices: z.record(z.string(), z.string().min(1))
}).strict();
export const developmentApplyInputSchema = developmentReviewInputSchema.extend({ token: digest });
export const developmentActionSchema = z.object({
  kind: z.enum(["project", "task"]), externalId: z.string(), title: z.string(),
  action: z.enum(["propose_create", "already_mapped", "review_possible_match"]),
  candidateId: z.string().nullable(), projectExternalId: z.string().optional(),
  dependsOn: z.array(z.string()).optional()
});
export const developmentPreviewSchema = z.object({
  catalogId: z.literal("orion-dev"), catalogSha256: digest, previewDigest: digest,
  readOnly: z.literal(true),
  snapshot: z.object({ targetWorkspaceId: z.string(), workspaces: z.array(z.object({ id: z.string(), name: z.string() })) }),
  catalog: z.object({
    projects: z.array(z.object({ id: z.string(), title: z.string(), phase: z.string().optional() })).optional(),
    workItems: z.array(z.object({ id: z.string(), phase: z.string().optional(), acceptance: z.array(z.string()).optional() }))
  }),
  plan: z.object({ workspaceId: z.string(), actions: z.array(developmentActionSchema) })
});
export const developmentConsentSchema = z.object({ token: digest, expiresAt: z.string().datetime() });
const imported = z.object({ externalId: z.string(), entityId: z.string(), outcome: z.enum(["created", "already_mapped", "confirmed_existing"]) });
export const developmentResultSchema = z.object({
  workspaceId: z.string(), catalogId: z.literal("orion-dev"), catalogSha256: digest,
  writePerformed: z.literal(true), projects: z.array(imported), tasks: z.array(imported),
  dependencies: z.object({ created: z.number().int(), existing: z.number().int() })
});
export type DevelopmentPreviewResponse = z.infer<typeof developmentPreviewSchema>;
export type DevelopmentImportResult = z.infer<typeof developmentResultSchema>;
