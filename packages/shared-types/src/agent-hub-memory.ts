import { z } from "zod";

/**
 * Agent memory (task 09.3). Memory is versioned knowledge, not a transcript:
 * a superseded record keeps its history and the active key is unique per scope.
 */
export const AGENT_MEMORY_SCOPES = ["user", "project", "agent", "global"] as const;
export const agentMemoryScopeSchema = z.enum(AGENT_MEMORY_SCOPES);
export type AgentMemoryScope = z.infer<typeof agentMemoryScopeSchema>;

export const AGENT_MEMORY_VALIDITIES = ["valid", "superseded", "outdated"] as const;
export const agentMemoryValiditySchema = z.enum(AGENT_MEMORY_VALIDITIES);
export type AgentMemoryValidity = z.infer<typeof agentMemoryValiditySchema>;

export const AGENT_MEMORY_SOURCES = ["agent", "user", "system"] as const;
export const agentMemorySourceSchema = z.enum(AGENT_MEMORY_SOURCES);
export type AgentMemorySource = z.infer<typeof agentMemorySourceSchema>;

export const agentMemoryRecordSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  scope: agentMemoryScopeSchema,
  /** userId for `user`, projectId for `project`, profileId for `agent`, null for `global`. */
  scopeId: z.string().min(1).nullable(),
  key: z.string().min(1),
  value: z.unknown(),
  source: agentMemorySourceSchema,
  /** Profile that wrote the record; null when a human wrote it directly. */
  agentId: z.string().min(1).nullable(),
  provenanceEventId: z.string().min(1).nullable(),
  validity: agentMemoryValiditySchema,
  supersededById: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type AgentMemoryRecord = z.infer<typeof agentMemoryRecordSchema>;

export const agentMemoryWriteInputSchema = z.object({
  scope: agentMemoryScopeSchema,
  /** For `project` (projectId) and `agent` (profileId, human writers only). */
  scopeId: z.string().trim().min(1).max(200).optional(),
  key: z.string().trim().min(1).max(200),
  value: z.unknown().refine((value) => value !== undefined, "value обязателен"),
  provenanceEventId: z.string().trim().min(1).max(200).optional()
}).strict();
export type AgentMemoryWriteInput = z.infer<typeof agentMemoryWriteInputSchema>;

export const agentMemoryReadQuerySchema = z.object({
  scope: agentMemoryScopeSchema.optional(),
  scopeId: z.string().trim().min(1).max(200).optional(),
  key: z.string().trim().min(1).max(200).optional(),
  includeHistory: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
}).transform((value) => ({
  scope: value.scope, scopeId: value.scopeId, key: value.key,
  includeHistory: value.includeHistory === "true",
  limit: value.limit ?? 200
}));
export type AgentMemoryReadQuery = z.infer<typeof agentMemoryReadQuerySchema>;

export const agentMemoryValidityInputSchema = z.object({
  validity: z.enum(["valid", "outdated"])
}).strict();
export type AgentMemoryValidityInput = z.infer<typeof agentMemoryValidityInputSchema>;

/** Context assembled before a run: memory plus the module capabilities the caller may use. */
export const agentHubContextInputSchema = z.object({
  executionId: z.string().trim().min(1).max(200).optional(),
  taskId: z.string().trim().min(1).max(200).optional(),
  projectId: z.string().trim().min(1).max(200).optional(),
  agentId: z.string().trim().min(1).max(200).optional(),
  includeCapabilities: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional()
}).strict();
export type AgentHubContextInput = z.infer<typeof agentHubContextInputSchema>;

export const agentHubContextQuerySchema = z.object({
  executionId: z.string().trim().min(1).max(200).optional(),
  taskId: z.string().trim().min(1).max(200).optional(),
  projectId: z.string().trim().min(1).max(200).optional(),
  agentId: z.string().trim().min(1).max(200).optional(),
  includeCapabilities: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
}).transform((value) => ({ ...value, includeCapabilities: value.includeCapabilities === "true" }));
export type AgentHubContextQuery = z.infer<typeof agentHubContextQuerySchema>;

export const agentHubContextEntrySchema = z.object({
  id: z.string().min(1),
  scope: agentMemoryScopeSchema,
  scopeId: z.string().min(1).nullable(),
  key: z.string().min(1),
  value: z.unknown(),
  source: agentMemorySourceSchema,
  validity: agentMemoryValiditySchema,
  /** Outdated memory is still shown, but the agent must re-check it before relying on it. */
  needsVerification: z.boolean(),
  updatedAt: z.string().datetime()
});
export type AgentHubContextEntry = z.infer<typeof agentHubContextEntrySchema>;

export const agentHubContextCapabilitySchema = z.object({
  moduleId: z.string().min(1),
  label: z.string().min(1),
  tools: z.array(z.object({ name: z.string().min(1), description: z.string(), effect: z.string() }))
});
export type AgentHubContextCapability = z.infer<typeof agentHubContextCapabilitySchema>;

export const agentHubContextResponseSchema = z.object({
  scopes: z.array(z.object({ scope: agentMemoryScopeSchema, scopeId: z.string().min(1).nullable() })),
  memory: z.array(agentHubContextEntrySchema),
  capabilities: z.array(agentHubContextCapabilitySchema),
  limits: z.object({ maxRecords: z.number().int().nonnegative(), maxBytes: z.number().int().nonnegative() }),
  truncated: z.boolean(),
  warnings: z.array(z.string())
});
export type AgentHubContextResponse = z.infer<typeof agentHubContextResponseSchema>;
