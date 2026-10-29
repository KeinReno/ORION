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
