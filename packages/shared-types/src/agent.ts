import { z } from "zod";
import { updateNoteInputSchema } from "./note";
import { updateTaskInputSchema } from "./task";

/**
 * ORION AI Bridge (docs/adr/ADR-0007-ai-bridge.md). An agent token is a revocable
 * credential issued by a workspace member; it acts with that member's rights, inside
 * one workspace, and only for the scopes ticked at creation. It never widens access.
 */
export const AGENT_SCOPES = ["tasks:read", "tasks:write", "notes:read", "notes:write", "projects:read", "events:read", "events:write", "agents:message", "agents:delegate", "finance:draft", "links:write"] as const;
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
  "agents:delegate": "Давать и брать задания у других агентов",
  "finance:draft": "Предлагать операции в финансах (черновики; записывает только человек)",
  "links:write": "Связывать объекты между собой (проекты, задачи, заметки, события)"
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

/**
 * Autonomy mode of a token (docs/tz/TZ-03, ADR-0007). A mode NARROWS the scopes, it never widens them:
 * - `observer`  — reads only; any write is 403.
 * - `assistant` — creates notes/tasks/events at once; changing an EXISTING object becomes a proposal a human approves.
 * - `manager`   — writes at once inside the scopes and limits; the dangerous (delete, finance, rights) is still a proposal.
 */
export const AGENT_MODES = ["observer", "assistant", "manager"] as const;
export const agentModeSchema = z.enum(AGENT_MODES);
export type AgentMode = z.infer<typeof agentModeSchema>;
export const AGENT_MODE_LABEL: Record<AgentMode, string> = { observer: "Наблюдатель", assistant: "Помощник", manager: "ИИ-менеджер" };
export const AGENT_MODE_HINT: Record<AgentMode, string> = {
  observer: "Только читает. Любая запись отклоняется.",
  assistant: "Создаёт заметки, задачи и события сразу; изменения существующего — только через ваше подтверждение.",
  manager: "Пишет сразу в пределах разрешений и лимитов; удаление и финансы — всё равно только через подтверждение."
};

/** The permission matrix: module × operation. `propose` = may file a request a human approves. */
export const AGENT_PERMISSION_MODULES = ["tasks", "notes", "events", "projects", "finance"] as const;
export const agentPermissionModuleSchema = z.enum(AGENT_PERMISSION_MODULES);
export type AgentPermissionModule = z.infer<typeof agentPermissionModuleSchema>;
export const AGENT_PERMISSION_MODULE_LABEL: Record<AgentPermissionModule, string> = {
  tasks: "Задачи",
  notes: "Заметки",
  events: "Календарь",
  projects: "Проекты",
  finance: "Финансы (черновики)"
};
export const AGENT_PERMISSION_OPS = ["read", "create", "update", "propose"] as const;
export const agentPermissionOpSchema = z.enum(AGENT_PERMISSION_OPS);
export type AgentPermissionOp = z.infer<typeof agentPermissionOpSchema>;
export const AGENT_PERMISSION_OP_LABEL: Record<AgentPermissionOp, string> = {
  read: "Читать",
  create: "Создавать",
  update: "Менять",
  propose: "Предлагать"
};
export const agentPermissionsSchema = z.object({
  tasks: z.array(agentPermissionOpSchema).optional(),
  notes: z.array(agentPermissionOpSchema).optional(),
  events: z.array(agentPermissionOpSchema).optional(),
  projects: z.array(agentPermissionOpSchema).optional(),
  finance: z.array(agentPermissionOpSchema).optional()
});
export type AgentPermissions = z.infer<typeof agentPermissionsSchema>;

/** "Never" flags, enforced on the server whatever the matrix says. */
export const AGENT_FORBIDDEN = ["finance", "documents", "delete"] as const;
export const agentForbiddenSchema = z.enum(AGENT_FORBIDDEN);
export type AgentForbidden = z.infer<typeof agentForbiddenSchema>;
export const AGENT_FORBIDDEN_LABEL: Record<AgentForbidden, string> = {
  finance: "Никогда: финансы",
  documents: "Никогда: документы",
  delete: "Никогда: удаление"
};

export const agentTokenSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  /** First characters of the secret — enough to recognise the token, useless as a credential. */
  prefix: z.string(),
  scopes: z.array(agentScopeSchema),
  /** Разрешения реестра для инструментов подключаемых модулей (G13), например `pet-care.pet.create`. */
  modulePermissions: z.array(z.string()),
  mode: agentModeSchema,
  /** `null` = the matrix is derived from `scopes` alone (a token issued before the matrix existed). */
  permissions: agentPermissionsSchema.nullable(),
  /** Empty = every project. Otherwise the token touches only objects of these projects. */
  allowedProjectIds: z.array(z.string()),
  forbidden: z.array(agentForbiddenSchema),
  /** Direct writes per hour; `null` = unlimited. */
  writeLimitPerHour: z.number().int().nullable(),
  /** Projects where a `manager` token may save an explicit decision note (tag «решение») without asking. Empty = off. */
  autoCommitProjectIds: z.array(z.string()),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string()
});
export type AgentToken = z.infer<typeof agentTokenSchema>;

/** Returned once, at creation: the only time the secret is visible. */
export const createdAgentTokenSchema = agentTokenSchema.extend({ secret: z.string() });
export type CreatedAgentToken = z.infer<typeof createdAgentTokenSchema>;

const agentRestrictionFields = {
  allowedProjectIds: z.array(z.string().min(1)).max(100).default([]),
  forbidden: z.array(agentForbiddenSchema).max(AGENT_FORBIDDEN.length).default([]),
  writeLimitPerHour: z.number().int().min(1).max(10_000).nullable().default(null),
  autoCommitProjectIds: z.array(z.string().min(1)).max(100).default([])
};

/**
 * Either `scopes` (the flat list, still valid) or `permissions` (the matrix) must grant something; with a matrix the
 * server derives the scopes. `agents:*` scopes ride along in `scopes` — they are not matrix modules.
 */
export const createAgentTokenInputSchema = z
  .object({
    name: z.string().trim().min(1, "Название обязательно").max(80),
    scopes: z.array(agentScopeSchema).max(AGENT_SCOPES.length).default([]),
    permissions: agentPermissionsSchema.optional(),
    /** Разрешения реестра для инструментов подключаемых модулей; сервер принимает только те, что объявлены манифестами. */
    modulePermissions: z.array(z.string().min(1)).max(100).default([]),
    mode: agentModeSchema.default("assistant"),
    ...agentRestrictionFields,
    /** `null` = no expiry (the settings screen warns about it). */
    expiresInDays: z.number().int().min(1).max(365).nullable().default(30)
  })
  .refine((v) => v.scopes.length > 0 || v.modulePermissions.length > 0 || Object.values(v.permissions ?? {}).some((ops) => (ops?.length ?? 0) > 0), {
    message: "Выберите хотя бы одно разрешение",
    path: ["scopes"]
  });
export type CreateAgentTokenInput = z.input<typeof createAgentTokenInputSchema>;
export type ParsedCreateAgentTokenInput = z.infer<typeof createAgentTokenInputSchema>;

/** What may change on a live token. Rights can only be narrowed here (the matrix is intersected with the scopes). */
export const updateAgentTokenInputSchema = z
  .object({
    mode: agentModeSchema,
    permissions: agentPermissionsSchema,
    allowedProjectIds: agentRestrictionFields.allowedProjectIds,
    forbidden: agentRestrictionFields.forbidden,
    writeLimitPerHour: agentRestrictionFields.writeLimitPerHour,
    autoCommitProjectIds: agentRestrictionFields.autoCommitProjectIds
  })
  .partial();
export type UpdateAgentTokenInput = z.infer<typeof updateAgentTokenInputSchema>;

export const agentAuditEntrySchema = z.object({
  id: z.string(),
  tokenId: z.string().nullable(),
  tokenName: z.string(),
  action: z.string(),
  resource: z.string().nullable(),
  status: z.number().int(),
  /** Module the call touched (`tasks`, `notes`, …); `null` for messaging and refusals before the module is known. */
  module: z.string().nullable(),
  /** One human sentence: what the agent did (type, object, fields). */
  summary: z.string().nullable(),
  objectType: z.string().nullable(),
  objectId: z.string().nullable(),
  /** A note/task the agent created and a human has not yet reverted. */
  undoable: z.boolean(),
  undoneAt: z.string().nullable(),
  createdAt: z.string()
});
export type AgentAuditEntry = z.infer<typeof agentAuditEntrySchema>;

/** Name of the short-lived token the built-in assistant chat issues per exchange (`AssistantChatService`). */
export const ASSISTANT_CHAT_TOKEN_NAME = "Чат ORION";

/**
 * Live activity of agents (what they are doing right now): `reading` and `writing` come from their calls,
 * `proposing` is a change waiting for your confirmation, `denied` a refused call, `thinking` the built-in assistant
 * waiting for its model.
 */
export const agentPresenceActivitySchema = z.enum(["reading", "writing", "proposing", "denied", "thinking"]);
export type AgentPresenceActivity = z.infer<typeof agentPresenceActivitySchema>;

export const agentPresenceEventSchema = z.object({
  id: z.number().int(),
  tokenId: z.string().nullable(),
  agentName: z.string(),
  /** The built-in assistant chat, not an external program. */
  assistant: z.boolean(),
  activity: agentPresenceActivitySchema,
  /** Module touched (`tasks`, `notes`, `calendar`, …) — the panel of that module lights up. */
  module: z.string().nullable(),
  summary: z.string().nullable(),
  objectType: z.string().nullable(),
  objectId: z.string().nullable(),
  at: z.string()
});
export type AgentPresenceEvent = z.infer<typeof agentPresenceEventSchema>;

/** The last two minutes of your agents' calls in this workspace; `now` is the server clock to age them against. */
export const agentPresenceSchema = z.object({ now: z.string(), events: z.array(agentPresenceEventSchema) });
export type AgentPresence = z.infer<typeof agentPresenceSchema>;

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

export const AGENT_PROPOSAL_ACTIONS = ["task.delete", "note.delete", "task.update", "note.update", "event.update"] as const;
export const agentProposalActionSchema = z.enum(AGENT_PROPOSAL_ACTIONS);
export type AgentProposalAction = z.infer<typeof agentProposalActionSchema>;

/**
 * Requests filed through a module tool (G13): the change of any module's record, applied by that module's own handler on
 * approval (`AgentModuleProposalsService`). Not accepted from `POST /ai/v1/proposals` — only the tool itself files them.
 */
export const AGENT_MODULE_PROPOSAL_ACTIONS = ["module.update", "module.delete"] as const;
export const agentProposalRecordActionSchema = z.enum([...AGENT_PROPOSAL_ACTIONS, ...AGENT_MODULE_PROPOSAL_ACTIONS]);
export type AgentProposalRecordAction = z.infer<typeof agentProposalRecordActionSchema>;

export const AGENT_PROPOSAL_ACTION_LABEL: Record<AgentProposalRecordAction, string> = {
  "task.delete": "Удалить задачу",
  "note.delete": "Удалить заметку",
  "task.update": "Изменить задачу",
  "note.update": "Изменить заметку",
  "event.update": "Изменить событие",
  "module.update": "Изменить",
  "module.delete": "Удалить"
};

/** A proposal nobody decided within this many days lapses (`expired`) and can no longer be approved. */
export const AGENT_PROPOSAL_TTL_DAYS = 7;

/** What an agent may change on a task / note — no delete, no reassignment, no dependency rewiring. */
export const agentTaskPatchSchema = updateTaskInputSchema.pick({
  title: true,
  description: true,
  status: true,
  priority: true,
  dueAt: true,
  expectedRevision: true
});
export const agentNotePatchSchema = updateNoteInputSchema.pick({
  title: true,
  summary: true,
  body: true,
  tags: true,
  expectedRevision: true
});

export const agentProposalDiffEntrySchema = z.object({
  field: z.string(),
  label: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable()
});
export type AgentProposalDiffEntry = z.infer<typeof agentProposalDiffEntrySchema>;

export const agentProposalSchema = z.object({
  id: z.string(),
  tokenId: z.string(),
  tokenName: z.string(),
  action: agentProposalRecordActionSchema,
  targetId: z.string(),
  targetTitle: z.string(),
  reason: z.string(),
  /** `expired` is computed: a pending proposal past its `expiresAt`. */
  status: z.enum(["pending", "approved", "rejected", "expired"]),
  /** Before/after of the fields an `*.update` proposal changes; empty for deletions. */
  diff: z.array(agentProposalDiffEntrySchema),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable()
});
export type AgentProposal = z.infer<typeof agentProposalSchema>;

export const createAgentProposalInputSchema = z
  .object({
    action: agentProposalActionSchema,
    targetId: z.string().min(1),
    reason: z.string().max(2000).default(""),
    /** The change an `*.update` proposal asks for; checked against the per-object patch schema on the server. */
    patch: z.record(z.string(), z.unknown()).optional()
  })
  .refine((v) => !v.action.endsWith(".update") || (v.patch !== undefined && Object.keys(v.patch).length > 0), {
    message: "Для изменения нужно указать patch",
    path: ["patch"]
  });
export type CreateAgentProposalInput = z.infer<typeof createAgentProposalInputSchema>;

/** The reply of a write endpoint when the token's mode turned the change into a proposal (HTTP 202). */
export interface AgentProposedResult {
  proposed: true;
  proposal: AgentProposal;
}

/** `code` of the 409 an approval gets when the object changed after the request was filed (body also has `currentDiff`). */
export const AGENT_PROPOSAL_STALE_CODE = "agent_proposal_stale";

/** `force: true` = the human saw the stale warning and applies the request over the newer state anyway. */
export const agentProposalApproveInputSchema = z.object({ force: z.boolean().optional() });
export type AgentProposalApproveInput = z.infer<typeof agentProposalApproveInputSchema>;

export const agentProposalBulkInputSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  decision: z.enum(["approve", "reject"])
});
export type AgentProposalBulkInput = z.infer<typeof agentProposalBulkInputSchema>;

export const agentProposalBulkResultSchema = z.object({
  results: z.array(z.object({ id: z.string(), ok: z.boolean(), error: z.string().nullable() }))
});
export type AgentProposalBulkResult = z.infer<typeof agentProposalBulkResultSchema>;

export const AGENT_AUDIT_RESULTS = ["ok", "proposed", "denied", "limited", "error"] as const;
export const agentAuditResultSchema = z.enum(AGENT_AUDIT_RESULTS);
export type AgentAuditResult = z.infer<typeof agentAuditResultSchema>;
export const AGENT_AUDIT_RESULT_LABEL: Record<AgentAuditResult, string> = {
  ok: "Выполнено",
  proposed: "Предложено",
  denied: "Отказано",
  limited: "Лимит",
  error: "Ошибка"
};

/** `result` from an HTTP status: 2xx ok, 202 proposed, 401/403 denied, 429 limited, the rest error. */
export function agentAuditResultOf(status: number): AgentAuditResult {
  if (status === 202) return "proposed";
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403) return "denied";
  if (status === 429) return "limited";
  return "error";
}

export const agentAuditQuerySchema = z.object({
  tokenId: z.string().min(1).optional(),
  module: z.string().min(1).max(40).optional(),
  result: agentAuditResultSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional()
});
export type AgentAuditQuery = z.infer<typeof agentAuditQuerySchema>;
