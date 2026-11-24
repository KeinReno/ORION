import { z } from "zod";
import { agentHubExecutionSchema } from "./agent-hub";

/**
 * Delegation, approval and policy contracts (task 09.1/9.4).
 *
 * Delegation is a parent execution asking an independent agent profile to do a
 * sub-order. Depth is bounded by a workspace policy owned by a human, and the
 * chain of profiles that already took part in the branch is the cycle guard.
 */
export const AGENT_HUB_DEFAULT_MAX_DELEGATION_DEPTH = 3;
export const AGENT_HUB_MAX_DELEGATION_DEPTH = 6;

/**
 * Кому нужно человеческое подтверждение операции выше read-only:
 *  - `non_admin` (default) — токенам с режимом ниже «Администратора» (agentMode !== "admin").
 *    Администратор действует без паузы;
 *  - `all` — каждый запрос `request_approval` останавливает исполнение до
 *    решения человека (поведение задания 09).
 */
export const AGENT_HUB_APPROVAL_POLICIES = ["non_admin", "all"] as const;
export type AgentHubApprovalPolicy = (typeof AGENT_HUB_APPROVAL_POLICIES)[number];
export const AGENT_HUB_DEFAULT_APPROVAL_POLICY: AgentHubApprovalPolicy = "non_admin";

/** Пауза waiting_approval требуется только если политика требует подтверждения для этого агента. */
export function agentHubApprovalPauseRequired(mode: AgentHubApprovalPolicy, requesterIsAdmin: boolean): boolean {
  if (mode === "all") return true;
  return !requesterIsAdmin;
}

export const agentHubDelegationPolicySchema = z.object({
  workspaceId: z.string().min(1),
  maxDelegationDepth: z.number().int().min(1).max(AGENT_HUB_MAX_DELEGATION_DEPTH),
  approvals: z.enum(AGENT_HUB_APPROVAL_POLICIES).default(AGENT_HUB_DEFAULT_APPROVAL_POLICY),
  updatedAt: z.string().datetime().nullable()
});
export type AgentHubDelegationPolicy = z.infer<typeof agentHubDelegationPolicySchema>;

export const agentHubDelegationPolicyInputSchema = z.object({
  maxDelegationDepth: z.number().int().min(1).max(AGENT_HUB_MAX_DELEGATION_DEPTH),
  approvals: z.enum(AGENT_HUB_APPROVAL_POLICIES).optional()
}).strict();
export type AgentHubDelegationPolicyInput = z.infer<typeof agentHubDelegationPolicyInputSchema>;

export const agentHubDelegationConstraintsSchema = z.object({
  /** The sub-order may only inspect, never change records. */
  readOnly: z.boolean().optional(),
  allowedModules: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  /** The delegator may tighten the workspace limit, never widen it. */
  maxDepth: z.number().int().min(1).max(AGENT_HUB_MAX_DELEGATION_DEPTH).optional()
}).strict();
export type AgentHubDelegationConstraints = z.infer<typeof agentHubDelegationConstraintsSchema>;

export const agentHubDelegateInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  targetAgentId: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(2000),
  instructions: z.string().trim().max(8000).optional(),
  taskId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  /** Materials already linked through the shared EntityLink layer. */
  materialLinkIds: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  constraints: agentHubDelegationConstraintsSchema.optional()
}).strict();
export type AgentHubDelegateInput = z.infer<typeof agentHubDelegateInputSchema>;

export const agentHubDelegationResultSchema = z.object({
  parent: agentHubExecutionSchema,
  execution: agentHubExecutionSchema
});
export type AgentHubDelegationResult = z.infer<typeof agentHubDelegationResultSchema>;

export const agentHubApprovalRequestInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  action: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(2000)
}).strict();
export type AgentHubApprovalRequestInput = z.infer<typeof agentHubApprovalRequestInputSchema>;

export const agentHubApproveInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative()
}).strict();
export type AgentHubApproveInput = z.infer<typeof agentHubApproveInputSchema>;

export const agentHubRejectInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(2000)
}).strict();
export type AgentHubRejectInput = z.infer<typeof agentHubRejectInputSchema>;

export const agentHubReassignInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  /** null keeps the new branch unassigned and open to the normal queue. */
  agentId: z.string().trim().min(1).max(200).nullable(),
  reason: z.string().trim().min(1).max(2000).optional()
}).strict();
export type AgentHubReassignInput = z.infer<typeof agentHubReassignInputSchema>;

export const agentHubReassignResultSchema = z.object({
  previous: agentHubExecutionSchema,
  execution: agentHubExecutionSchema
});
export type AgentHubReassignResult = z.infer<typeof agentHubReassignResultSchema>;

export type AgentHubDelegationPlan =
  | { ok: true; chain: string[]; depth: number }
  | { ok: false; reason: "delegation_cycle" | "delegation_depth_exceeded" };

/**
 * Pure delegation guard: returns the chain including the target profile and the
 * next depth, or the reason to refuse. `A → B → A` is a cycle because A is
 * already present in the branch chain.
 */
export function planAgentHubDelegation(input: {
  parentChain: readonly string[];
  parentDepth: number;
  parentDelegatedTo: string | null;
  delegatorProfileId: string;
  targetProfileId: string;
  maxDepth: number;
}): AgentHubDelegationPlan {
  const chain = [...input.parentChain];
  if (input.parentDelegatedTo && !chain.includes(input.parentDelegatedTo)) chain.push(input.parentDelegatedTo);
  if (!chain.includes(input.delegatorProfileId)) chain.push(input.delegatorProfileId);
  if (chain.includes(input.targetProfileId)) return { ok: false, reason: "delegation_cycle" };
  const depth = input.parentDepth + 1;
  if (depth > input.maxDepth) return { ok: false, reason: "delegation_depth_exceeded" };
  return { ok: true, chain: [...chain, input.targetProfileId], depth };
}

/** The effective limit is the stricter of the workspace policy and the delegator's constraint. */
export function effectiveAgentHubDelegationDepth(
  policyDepth: number,
  constraintDepth: number | undefined
): number {
  const policy = clampDelegationDepth(policyDepth);
  return constraintDepth === undefined ? policy : Math.min(policy, clampDelegationDepth(constraintDepth));
}

function clampDelegationDepth(value: number): number {
  if (!Number.isFinite(value)) return AGENT_HUB_DEFAULT_MAX_DELEGATION_DEPTH;
  return Math.min(AGENT_HUB_MAX_DELEGATION_DEPTH, Math.max(1, Math.trunc(value)));
}
