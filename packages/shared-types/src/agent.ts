import { z } from "zod";

/**
 * ORION AI Bridge (docs/adr/ADR-0007-ai-bridge.md). An agent token is a revocable
 * credential issued by a workspace member; it acts with that member's rights, inside
 * one workspace, and only for the scopes ticked at creation. It never widens access.
 */
export const AGENT_SCOPES = ["tasks:read", "tasks:write", "notes:read", "notes:write", "projects:read", "events:read", "events:write", "agents:message", "agents:delegate"] as const;
export const agentScopeSchema = z.enum(AGENT_SCOPES);
export type AgentScope = z.infer<typeof agentScopeSchema>;

export const AGENT_SCOPE_LABEL: Record<AgentScope, string> = {
  "tasks:read": "Читать задачи",
  "tasks:write": "Создавать и менять задачи",
  "notes:read": "Читать заметки",
  "notes:write": "Создавать и менять заметки",
  "projects:read": "Читать проекты",
  "events:read": "Читать события календаря",
  "events:write": "Создавать и менять события календаря",
  "agents:message": "Переписываться с другими агентами",
  "agents:delegate": "Давать и брать задания у других агентов"
};

/**
 * What an agent may write on a calendar event (`events:write`): the plain fields only. No
 * recurrence, colour, timezone or link — and no delete, as everywhere in the bridge. Edits
 * to a recurring event always apply to the whole series.
 */
export const agentEventCreateSchema = z
  .object({
    title: z.string().trim().min(1, "Название обязательно").max(200),
    description: z.string().max(20_000).default(""),
    location: z.string().max(300).nullable().optional(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    allDay: z.boolean().default(false),
    reminders: z.array(z.number().int().min(0).max(40_320)).max(5).default([]),
    projectId: z.string().nullable().optional()
  })
  .refine((e) => new Date(e.endAt).getTime() > new Date(e.startAt).getTime(), {
    message: "Конец должен быть позже начала",
    path: ["endAt"]
  });
export type AgentEventCreate = z.infer<typeof agentEventCreateSchema>;

export const agentEventPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20_000).optional(),
  location: z.string().max(300).nullable().optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  allDay: z.boolean().optional(),
  reminders: z.array(z.number().int().min(0).max(40_320)).max(5).optional(),
  projectId: z.string().nullable().optional()
});
export type AgentEventPatch = z.infer<typeof agentEventPatchSchema>;

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

/** A peer an agent may write to: another live token of the same workspace. */
export const agentPeerSchema = z.object({ id: z.string(), name: z.string() });
export type AgentPeer = z.infer<typeof agentPeerSchema>;

export const agentMessageSchema = z.object({
  id: z.string(),
  fromTokenId: z.string(),
  fromName: z.string(),
  toTokenId: z.string(),
  subject: z.string(),
  body: z.string(),
  createdAt: z.string(),
  readAt: z.string().nullable()
});
export type AgentMessage = z.infer<typeof agentMessageSchema>;

export const sendAgentMessageInputSchema = z.object({
  toTokenId: z.string().min(1),
  subject: z.string().trim().min(1, "Тема обязательна").max(200),
  body: z.string().max(20_000).default("")
});
export type SendAgentMessageInput = z.infer<typeof sendAgentMessageInputSchema>;

export const agentJobStatusSchema = z.enum(["pending", "in_progress", "done", "failed", "canceled"]);
export type AgentJobStatus = z.infer<typeof agentJobStatusSchema>;

export const agentJobSchema = z.object({
  id: z.string(),
  fromTokenId: z.string(),
  fromName: z.string(),
  toTokenId: z.string(),
  toName: z.string(),
  title: z.string(),
  body: z.string(),
  status: agentJobStatusSchema,
  result: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type AgentJob = z.infer<typeof agentJobSchema>;

export const createAgentJobInputSchema = z.object({
  toTokenId: z.string().min(1),
  title: z.string().trim().min(1, "Название обязательно").max(200),
  body: z.string().max(20_000).default("")
});
export type CreateAgentJobInput = z.infer<typeof createAgentJobInputSchema>;

/** The assignee reports progress; the giver may only cancel. */
export const updateAgentJobInputSchema = z.object({
  status: agentJobStatusSchema,
  result: z.string().max(20_000).optional()
});
export type UpdateAgentJobInput = z.infer<typeof updateAgentJobInputSchema>;

export const AGENT_PROPOSAL_ACTIONS = ["task.delete", "note.delete"] as const;
export const agentProposalActionSchema = z.enum(AGENT_PROPOSAL_ACTIONS);
export type AgentProposalAction = z.infer<typeof agentProposalActionSchema>;

export const AGENT_PROPOSAL_ACTION_LABEL: Record<AgentProposalAction, string> = {
  "task.delete": "Удалить задачу",
  "note.delete": "Удалить заметку"
};

export const agentProposalSchema = z.object({
  id: z.string(),
  tokenId: z.string(),
  tokenName: z.string(),
  action: agentProposalActionSchema,
  targetId: z.string(),
  targetTitle: z.string(),
  reason: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  createdAt: z.string(),
  decidedAt: z.string().nullable()
});
export type AgentProposal = z.infer<typeof agentProposalSchema>;

export const createAgentProposalInputSchema = z.object({
  action: agentProposalActionSchema,
  targetId: z.string().min(1),
  reason: z.string().max(2000).default("")
});
export type CreateAgentProposalInput = z.infer<typeof createAgentProposalInputSchema>;
