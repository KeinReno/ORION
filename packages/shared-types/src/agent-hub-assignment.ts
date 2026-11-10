import { z } from "zod";

export const agentHubAgentProfileSchema = z.object({
  id: z.string().min(1), name: z.string().trim().min(1).max(100),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  credentialStatus: z.enum(["active", "revoked", "expired", "missing", "unavailable"])
});
export type AgentHubAgentProfile = z.infer<typeof agentHubAgentProfileSchema>;
export const agentHubAgentProfilesResponseSchema = z.object({ agents: z.array(agentHubAgentProfileSchema) });
export type AgentHubAgentProfilesResponse = z.infer<typeof agentHubAgentProfilesResponseSchema>;

export const agentHubCredentialOptionSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), scopes: z.array(z.string()), expiresAt: z.string().datetime().nullable()
});
export type AgentHubCredentialOption = z.infer<typeof agentHubCredentialOptionSchema>;
export const agentHubCredentialOptionsResponseSchema = z.object({ credentials: z.array(agentHubCredentialOptionSchema) });
export type AgentHubCredentialOptionsResponse = z.infer<typeof agentHubCredentialOptionsResponseSchema>;

export const agentHubCredentialStatusSchema = z.enum(["active", "revoked", "expired", "missing", "unavailable"]);
export type AgentHubCredentialStatus = z.infer<typeof agentHubCredentialStatusSchema>;

export const agentHubTaskAssignmentSchema = z.object({
  workspaceId: z.string().min(1), taskId: z.string().min(1),
  agent: z.object({ id: z.string().min(1), name: z.string().min(1) }).nullable(),
  credentialStatus: agentHubCredentialStatusSchema,
  updatedAt: z.string().datetime()
});
export type AgentHubTaskAssignment = z.infer<typeof agentHubTaskAssignmentSchema>;

export const agentHubCreateAgentProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(100), credentialIds: z.array(z.string().min(1)).min(1).max(20)
}).strict();
export type AgentHubCreateAgentProfileInput = z.infer<typeof agentHubCreateAgentProfileInputSchema>;

export const agentHubBindAgentCredentialsInputSchema = z.object({ credentialIds: z.array(z.string().min(1)).min(1).max(20) }).strict();
export type AgentHubBindAgentCredentialsInput = z.infer<typeof agentHubBindAgentCredentialsInputSchema>;

export const agentHubSetTaskAssignmentInputSchema = z.object({ agentId: z.string().min(1).nullable() }).strict();
export type AgentHubSetTaskAssignmentInput = z.infer<typeof agentHubSetTaskAssignmentInputSchema>;
