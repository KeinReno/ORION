import { z } from "zod";

/**
 * ORION AI Bridge (docs/adr/ADR-0007-ai-bridge.md). An agent token is a revocable
 * credential issued by a workspace member; it acts with that member's rights, inside
 * one workspace, and only for the scopes ticked at creation. It never widens access.
 */
export const AGENT_SCOPES = ["tasks:read", "tasks:write", "notes:read", "notes:write", "projects:read"] as const;
export const agentScopeSchema = z.enum(AGENT_SCOPES);
export type AgentScope = z.infer<typeof agentScopeSchema>;

export const AGENT_SCOPE_LABEL: Record<AgentScope, string> = {
  "tasks:read": "Читать задачи",
  "tasks:write": "Создавать и менять задачи",
  "notes:read": "Читать заметки",
  "notes:write": "Создавать и менять заметки",
  "projects:read": "Читать проекты"
};

export const AGENT_TOKEN_PREFIX = "orion_agt_";

export const agentTokenSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  /** First characters of the secret — enough to recognise the token, useless as a credential. */
  prefix: z.string(),
  scopes: z.array(agentScopeSchema),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string()
});
export type AgentToken = z.infer<typeof agentTokenSchema>;

/** Returned once, at creation: the only time the secret is visible. */
export const createdAgentTokenSchema = agentTokenSchema.extend({ secret: z.string() });
export type CreatedAgentToken = z.infer<typeof createdAgentTokenSchema>;

export const createAgentTokenInputSchema = z.object({
  name: z.string().trim().min(1, "Название обязательно").max(80),
  scopes: z.array(agentScopeSchema).min(1, "Выберите хотя бы одно разрешение").max(AGENT_SCOPES.length),
  expiresInDays: z.number().int().min(1).max(365).default(30)
});
export type CreateAgentTokenInput = z.infer<typeof createAgentTokenInputSchema>;

export const agentAuditEntrySchema = z.object({
  id: z.string(),
  tokenId: z.string().nullable(),
  tokenName: z.string(),
  action: z.string(),
  resource: z.string().nullable(),
  status: z.number().int(),
  createdAt: z.string()
});
export type AgentAuditEntry = z.infer<typeof agentAuditEntrySchema>;
