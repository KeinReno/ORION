import { z } from "zod";

/**
 * Agent Hub v0: versioned, runtime-independent execution contract.
 * This is NOT the existing AgentJob/Task record: one user task or agent job
 * may produce multiple execution attempts over time.
 *
 * v2 (task 09) adds `waiting_approval` and `reassigned` additively: existing
 * wire values (`queued|claimed|working|blocked|review|done|failed|canceled`)
 * keep their meaning, because the previous client and the durable journal must
 * survive the migration. `running` is the pair `claimed`/`working`; `cancelled`
 * is stored as `canceled` for historical parity.
 */
export const AGENT_HUB_EXECUTION_STATUSES = [
  "queued", "claimed", "working", "waiting_approval", "blocked", "review", "done", "failed", "canceled", "reassigned"
] as const;
export const agentHubExecutionStatusSchema = z.enum(AGENT_HUB_EXECUTION_STATUSES);
export type AgentHubExecutionStatus = z.infer<typeof agentHubExecutionStatusSchema>;

/** Terminal states free the "one active execution per target" partial index. */
export const AGENT_HUB_TERMINAL_STATUSES = ["done", "failed", "canceled", "reassigned"] as const;
export const AGENT_HUB_TERMINAL_STATUS_SET: ReadonlySet<AgentHubExecutionStatus> = new Set(AGENT_HUB_TERMINAL_STATUSES);
export const agentHubIsTerminal = (status: AgentHubExecutionStatus): boolean => AGENT_HUB_TERMINAL_STATUS_SET.has(status);

export const agentHubTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task"), id: z.string().min(1) }),
  z.object({ kind: z.literal("agent_job"), id: z.string().min(1) }),
  /** A delegated sub-order: `id` is the child execution's own id, never a Task id. */
  z.object({ kind: z.literal("delegation"), id: z.string().min(1) })
]);
export type AgentHubTarget = z.infer<typeof agentHubTargetSchema>;

/** Human approval requested by a worker before a non-read-only operation. */
export const agentHubApprovalRequestSchema = z.object({
  action: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(2000),
  requestedAt: z.string().datetime(),
  requestedBy: z.string().min(1)
});
export type AgentHubApprovalRequest = z.infer<typeof agentHubApprovalRequestSchema>;

export const agentHubExecutionSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  target: agentHubTargetSchema,
  status: agentHubExecutionStatusSchema,
  revision: z.number().int().nonnegative(),
  attempt: z.number().int().nonnegative(),
  workerId: z.string().min(1).nullable(),
  runtimeId: z.string().min(1).nullable(),
  leaseUntil: z.string().datetime().nullable(),
  checkpointRef: z.string().min(1).nullable(),
  evidenceRefs: z.array(z.string().min(1)),
  verifiedBy: z.string().min(1).nullable(),
  blockedReason: z.string().min(1).nullable(),
  /** Delegation tree: null for a root execution. */
  parentExecutionId: z.string().min(1).nullable(),
  delegationDepth: z.number().int().nonnegative(),
  delegatedToProfileId: z.string().min(1).nullable(),
  /** Profile ids already involved in this branch, oldest first (cycle guard). */
  delegationChain: z.array(z.string().min(1)),
  delegationPayload: z.record(z.unknown()),
  approval: agentHubApprovalRequestSchema.nullable(),
  /** Short result summary handed to the parent when this branch ends. */
  resultSummary: z.string().min(1).nullable(),
  updatedAt: z.string().datetime()
});
export type AgentHubExecution = z.infer<typeof agentHubExecutionSchema>;

/** Only a trusted coordinator can issue expire/requeue/cancel/verify commands. */
const commandFields = {
  expectedRevision: z.number().int().nonnegative(),
  at: z.string().datetime()
};
const leaseDuration = z.number().int().min(30_000).max(1_800_000);

export const agentHubCommandSchema = z.discriminatedUnion("type", [
  z.object({ ...commandFields, type: z.literal("claim"), workerId: z.string().min(1), runtimeId: z.string().min(1), leaseMs: leaseDuration }),
  z.object({ ...commandFields, type: z.literal("start"), workerId: z.string().min(1) }),
  z.object({ ...commandFields, type: z.literal("heartbeat"), workerId: z.string().min(1), leaseMs: leaseDuration }),
  z.object({ ...commandFields, type: z.literal("checkpoint"), workerId: z.string().min(1), checkpointRef: z.string().min(1) }),
  z.object({ ...commandFields, type: z.literal("block"), workerId: z.string().min(1), reason: z.string().trim().min(1).max(2000) }),
  z.object({ ...commandFields, type: z.literal("submit"), workerId: z.string().min(1), evidenceRefs: z.array(z.string().min(1)).min(1), summary: z.string().trim().min(1).max(4000).optional() }),
  z.object({ ...commandFields, type: z.literal("verify"), reviewerId: z.string().min(1) }),
  z.object({ ...commandFields, type: z.literal("fail"), workerId: z.string().min(1), reason: z.string().trim().min(1).max(2000), summary: z.string().trim().min(1).max(4000).optional() }),
  z.object({ ...commandFields, type: z.literal("expire") }),
  z.object({ ...commandFields, type: z.literal("requeue") }),
  z.object({ ...commandFields, type: z.literal("cancel") }),
  /** Agent > read-only operation pauses the execution until a human decides. */
  z.object({ ...commandFields, type: z.literal("request_approval"), workerId: z.string().min(1), action: z.string().trim().min(1).max(200), reason: z.string().trim().min(1).max(2000) }),
  z.object({ ...commandFields, type: z.literal("approve"), reviewerId: z.string().min(1) }),
  z.object({ ...commandFields, type: z.literal("reject"), reviewerId: z.string().min(1), reason: z.string().trim().min(1).max(2000) }),
  /** The current branch ends; the service opens an independent replacement branch. */
  z.object({ ...commandFields, type: z.literal("reassign"), reason: z.string().trim().min(1).max(2000).optional() })
]);
export type AgentHubCommand = z.infer<typeof agentHubCommandSchema>;

export const agentHubRuntimeCapabilitiesSchema = z.object({
  kind: z.enum(["manual_mcp", "official_cli", "local_model", "authorized_api"]),
  canStart: z.boolean(),
  canCancel: z.boolean(),
  canObserve: z.boolean(),
  canResume: z.boolean()
});
export type AgentHubRuntimeCapabilities = z.infer<typeof agentHubRuntimeCapabilitiesSchema>;
