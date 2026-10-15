import { z } from "zod";
import { agentScopeSchema } from "./agent";
import { relationKindSchema } from "./search";

/**
 * Agent Gateway (docs/tz/TZ-02-agent-gateway.md, ADR-0014): the public contract an agent that has NO
 * source code uses to find its way around an installed ORION — `context`, `capture`, `links`, `search`.
 * Everything here is data an agent may see; none of it names an internal table.
 */
export const AGENT_API_VERSION = "1";

/** Objects an agent may link and search: exactly the ones it has read scopes for. */
export const AGENT_ENTITY_TYPES = ["project", "task", "note", "event"] as const;
export const agentEntityTypeSchema = z.enum(AGENT_ENTITY_TYPES);
export type AgentEntityType = z.infer<typeof agentEntityTypeSchema>;

/** The scopes that open (read or write) each type to a token. Search and links honour exactly these. */
export const AGENT_ENTITY_SCOPES: Record<AgentEntityType, readonly [read: "projects:read" | "tasks:read" | "notes:read" | "events:read", ...write: Array<"tasks:write" | "notes:write" | "events:write">]> = {
  project: ["projects:read"],
  task: ["tasks:read", "tasks:write"],
  note: ["notes:read", "notes:write"],
  event: ["events:read", "events:write"]
};

export const AGENT_ENTITY_LABEL: Record<AgentEntityType | "inbox", string> = {
  project: "проект",
  task: "задача",
  note: "заметка",
  event: "событие",
  inbox: "запись во «Входящих»"
};

export const agentEntityRefSchema = z.object({
  type: agentEntityTypeSchema,
  id: z.string().trim().min(1)
});
export type AgentEntityRef = z.infer<typeof agentEntityRefSchema>;

/** Which entity types the token may touch (read or write scope). */
export function agentAccessibleTypes(scopes: readonly string[]): AgentEntityType[] {
  return AGENT_ENTITY_TYPES.filter((type) => AGENT_ENTITY_SCOPES[type].some((scope) => scopes.includes(scope)));
}

// ── Deep links ──────────────────────────────────────────────────────────────────────────────────
/**
 * `orion://open?type=note&id=…&workspace=…` — the one link format an agent hands back to a person.
 * The web client opens the same thing at `/open?type=…` (apps/web/app/open), the desktop shell registers the
 * `orion` scheme and forwards it there. A link is navigation only: the target panel loads the record through its
 * own access-checked API, so a link never widens access.
 */
export const ORION_LINK_SCHEME = "orion";
export const ORION_LINK_TYPES = [...AGENT_ENTITY_TYPES, "inbox"] as const;
export type OrionLinkType = (typeof ORION_LINK_TYPES)[number];

export function buildOrionLink(link: { type: OrionLinkType; id: string; workspaceId: string }): string {
  const query = new URLSearchParams({ type: link.type, id: link.id, workspace: link.workspaceId });
  return `${ORION_LINK_SCHEME}://open?${query.toString()}`;
}

/** Accepts the query part of `orion://open?…` or of the web route `/open?…`; `null` for anything malformed. */
export function parseOrionLink(input: string): { type: OrionLinkType; id: string; workspaceId: string } | null {
  const queryStart = input.indexOf("?");
  const params = new URLSearchParams(queryStart >= 0 ? input.slice(queryStart + 1) : input);
  const type = params.get("type");
  const id = params.get("id");
  const workspaceId = params.get("workspace");
  if (!type || !id || !workspaceId) return null;
  if (!(ORION_LINK_TYPES as readonly string[]).includes(type)) return null;
  return { type: type as OrionLinkType, id, workspaceId };
}

// ── Capture ─────────────────────────────────────────────────────────────────────────────────────
/**
 * `hint` is the only way a caller chooses a destination. ORION never classifies text with a model: without a
 * hint (and without an explicit `/task` · `/note` · `!` prefix, the same rules as the quick-capture field) the
 * text lands in the Inbox for a person to sort.
 */
export const AGENT_CAPTURE_HINTS = ["idea", "task", "note", "event", "reminder"] as const;
export const agentCaptureHintSchema = z.enum(AGENT_CAPTURE_HINTS);
export type AgentCaptureHint = z.infer<typeof agentCaptureHintSchema>;

export const AGENT_CAPTURE_HINT_INFO: Record<AgentCaptureHint, { creates: "note" | "task" | "event"; scope: "notes:write" | "tasks:write" | "events:write"; needsDueAt: boolean; note: string }> = {
  idea: { creates: "note", scope: "notes:write", needsDueAt: false, note: "заметка с тегом «идея»" },
  note: { creates: "note", scope: "notes:write", needsDueAt: false, note: "заметка" },
  task: { creates: "task", scope: "tasks:write", needsDueAt: false, note: "задача" },
  reminder: { creates: "task", scope: "tasks:write", needsDueAt: true, note: "задача со сроком (dueAt обязателен) — ORION напомнит о ней" },
  event: { creates: "event", scope: "events:write", needsDueAt: true, note: "событие на 30 минут с началом в dueAt (обязателен)" }
};

export const agentCaptureInputSchema = z.object({
  text: z.string().trim().min(1, "Текст обязателен").max(20_000),
  title: z.string().trim().min(1).max(200).optional(),
  hint: agentCaptureHintSchema.optional(),
  projectId: z.string().trim().min(1).optional(),
  /** Free-form name of the client or conversation the text came from. Shown to the person; never trusted. */
  source: z.string().trim().min(1).max(120).optional(),
  /** Same key + same token → the same record again, never a second one. */
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  /** When: the task's deadline (`task`/`reminder`) or the event's start (`event`). ISO-8601. */
  dueAt: z.string().datetime().optional(),
  links: z.array(agentEntityRefSchema.extend({ kind: relationKindSchema.optional() })).max(10).optional()
});
export type AgentCaptureInput = z.infer<typeof agentCaptureInputSchema>;

export const agentCaptureResultSchema = z.object({
  status: z.enum(["created", "inbox"]),
  kind: z.enum(["note", "task", "event", "inbox"]),
  id: z.string(),
  url: z.string(),
  workspaceId: z.string(),
  projectId: z.string().nullable(),
  deduplicated: z.boolean(),
  /** Why the text went to the Inbox instead of a note/task/event. Present only for `status: "inbox"`. */
  reason: z.string().optional(),
  /** How many of `links` were created. */
  linked: z.number().int()
});
export type AgentCaptureResult = z.infer<typeof agentCaptureResultSchema>;

// ── Links ───────────────────────────────────────────────────────────────────────────────────────
export const agentLinkInputSchema = z.object({
  sourceType: agentEntityTypeSchema,
  sourceId: z.string().trim().min(1),
  targetType: agentEntityTypeSchema,
  targetId: z.string().trim().min(1),
  kind: relationKindSchema.default("related_to")
});
export type AgentLinkInput = z.infer<typeof agentLinkInputSchema>;

export const agentLinkSchema = z.object({
  id: z.string(),
  sourceType: agentEntityTypeSchema,
  sourceId: z.string(),
  targetType: agentEntityTypeSchema,
  targetId: z.string(),
  kind: relationKindSchema,
  sourceUrl: z.string(),
  targetUrl: z.string()
});
export type AgentLink = z.infer<typeof agentLinkSchema>;

// ── Search ──────────────────────────────────────────────────────────────────────────────────────
export const agentSearchResultSchema = z.object({
  type: agentEntityTypeSchema,
  id: z.string(),
  title: z.string(),
  url: z.string(),
  snippet: z.string()
});
export type AgentSearchResult = z.infer<typeof agentSearchResultSchema>;

export const agentSearchResponseSchema = z.object({
  results: z.array(agentSearchResultSchema),
  /** The types this token may search; anything else is invisible to it, not "empty". */
  searched: z.array(agentEntityTypeSchema)
});
export type AgentSearchResponse = z.infer<typeof agentSearchResponseSchema>;

// ── Context ─────────────────────────────────────────────────────────────────────────────────────
export const AGENT_CAPABILITIES = ["context", "manual", "capture", "search", "links", "tasks", "notes", "events", "projects", "finance_drafts", "agent_messages", "agent_jobs", "deletion_proposals"] as const;
export const agentCapabilitySchema = z.enum(AGENT_CAPABILITIES);
export type AgentCapability = z.infer<typeof agentCapabilitySchema>;

export const agentGatewayContextSchema = z.object({
  apiVersion: z.string(),
  workspace: z.object({ id: z.string(), name: z.string(), role: z.string() }),
  token: z.object({ name: z.string(), scopes: z.array(agentScopeSchema), expiresAt: z.string().nullable() }),
  /** Enabled modules the token's scopes reach. Modules it cannot touch are not listed. */
  modules: z.array(z.object({ id: z.string(), label: z.string() })),
  /** Active projects (up to `limits.projects`); `null` when the token has no `projects:read`. */
  projects: z.array(z.object({ id: z.string(), name: z.string(), url: z.string() })).nullable(),
  capture: z.object({
    /** Without a hint the text goes to the Inbox. */
    inbox: z.boolean(),
    hints: z.array(z.object({ hint: agentCaptureHintSchema, creates: z.string(), available: z.boolean(), requires: z.string(), note: z.string() }))
  }),
  links: z.object({ types: z.array(agentEntityTypeSchema), kinds: z.array(relationKindSchema) }),
  search: z.object({ types: z.array(agentEntityTypeSchema) }),
  limits: z.object({
    callsPerMinute: z.number().int(),
    textMaxLength: z.number().int(),
    projects: z.number().int(),
    linksPerCapture: z.number().int()
  }),
  /** Operations a person must approve; the agent can only ask. */
  requiresConfirmation: z.array(z.object({ operation: z.string(), how: z.string() })),
  capabilities: z.array(agentCapabilitySchema),
  /** The link format returned in `url` fields. */
  linkFormat: z.string()
});
export type AgentGatewayContext = z.infer<typeof agentGatewayContextSchema>;

export const AGENT_CONFIRMATION_RULES: Array<{ operation: string; how: string }> = [
  { operation: "task.delete / note.delete", how: "Агент не удаляет: POST /ai/v1/proposals создаёт запрос, человек подтверждает его в Настройки → ИИ-агенты." },
  { operation: "finance.draft", how: "Операция — только черновик; человек правит и подтверждает её в «Финансах». Баланс до этого не меняется." },
  { operation: "capture без hint", how: "Текст попадает во «Входящие» и ждёт разбора человеком; ORION не угадывает, чем он является." }
];

export const AGENT_LIMITS = { textMaxLength: 20_000, projects: 100, linksPerCapture: 10 } as const;

// ── Connection info (the "Подключить агента" wizard) ─────────────────────────────────────────────
/**
 * How THIS running ORION is launched as an MCP server, with real paths of the install the user is looking at.
 * `launcher`: `installed` = the packaged app's bundled Node + compiled adapter (or a built checkout); `repo` = a source
 * checkout's dev shim `scripts/orion-mcp.mjs`; `unavailable` = no adapter found (the wizard then offers the REST contract).
 */
export const agentConnectionInfoSchema = z.object({
  bridgeEnabled: z.boolean(),
  mode: z.enum(["local", "server"]),
  /** Where the agent's HTTP calls go; `null` when this server does not know its public address. */
  apiUrl: z.string().nullable(),
  launcher: z.enum(["installed", "repo", "unavailable"]),
  command: z.string().nullable(),
  args: z.array(z.string()),
  manualPath: z.string().nullable()
});
export type AgentConnectionInfo = z.infer<typeof agentConnectionInfoSchema>;

/** The scopes the wizard ticks by default: read the map, save and link, never delete. */
export const AGENT_RECOMMENDED_SCOPES = ["projects:read", "notes:read", "notes:write", "tasks:read", "tasks:write", "links:write"] as const;
