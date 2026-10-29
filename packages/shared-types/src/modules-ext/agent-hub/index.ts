import { z } from "zod";

/** Human-originated execution for an existing Tasks item. AgentJob bridge is a later wave. */
export const agentHubCreateExecutionInputSchema = z.object({
  taskId: z.string().uuid(),
  requestId: z.string().uuid().optional()
});
export type AgentHubCreateExecutionInput = z.infer<typeof agentHubCreateExecutionInputSchema>;

export const agentHubCancelInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative()
});
export type AgentHubCancelInput = z.infer<typeof agentHubCancelInputSchema>;

export const agentHubEventSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  executionId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  action: z.string(),
  actorId: z.string(),
  data: z.record(z.unknown()),
  at: z.string().datetime()
});
export type AgentHubEvent = z.infer<typeof agentHubEventSchema>;

/** Manual MCP claims, never a request to spawn the IDE. Worker identity is server-bound to the authenticated token. */
export const agentHubClaimInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative()
});
export type AgentHubClaimInput = z.infer<typeof agentHubClaimInputSchema>;

const reportRevision = { expectedRevision: z.number().int().nonnegative() };
export const agentHubReportInputSchema = z.discriminatedUnion("action", [
  z.object({ ...reportRevision, action: z.literal("start") }),
  z.object({ ...reportRevision, action: z.literal("heartbeat") }),
  z.object({ ...reportRevision, action: z.literal("checkpoint"), checkpointRef: z.string().trim().min(1).max(1000) }),
  z.object({ ...reportRevision, action: z.literal("submit"), evidenceRefs: z.array(z.string().trim().min(1).max(1000)).min(1).max(20) }),
  z.object({ ...reportRevision, action: z.literal("block"), reason: z.string().trim().min(1).max(2000) }),
  z.object({ ...reportRevision, action: z.literal("fail"), reason: z.string().trim().min(1).max(2000) })
]);
export type AgentHubReportInput = z.infer<typeof agentHubReportInputSchema>;

export const agentHubReconcileResultSchema = z.object({ recovered: z.number().int().nonnegative() });
export type AgentHubReconcileResult = z.infer<typeof agentHubReconcileResultSchema>;
