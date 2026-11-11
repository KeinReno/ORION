import { z } from "zod";

/**
 * Agent Hub trace model (task 09.2).
 *
 * Only facts an executor actually reports are stored: tool calls/results,
 * delegations, approval waits, notes and errors. A model's private reasoning is
 * never captured and is never reconstructed from a transcript.
 */
export const AGENT_HUB_STEP_TYPES = ["tool_call", "tool_result", "delegation", "approval_wait", "note", "error"] as const;
export const agentHubStepTypeSchema = z.enum(AGENT_HUB_STEP_TYPES);
export type AgentHubStepType = z.infer<typeof agentHubStepTypeSchema>;

export const agentHubJsonValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.unknown())
]);
export type AgentHubJsonValue = z.infer<typeof agentHubJsonValueSchema>;

export const agentHubTraceStepSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  executionId: z.string().min(1),
  /** Client-supplied logical step id, unique inside one execution. */
  stepId: z.string().min(1),
  parentStepId: z.string().min(1).nullable(),
  type: agentHubStepTypeSchema,
  name: z.string().min(1).nullable(),
  /** Stable agent profile when the caller's credential is bound to one. */
  agentId: z.string().min(1).nullable(),
  actorId: z.string().min(1),
  payload: z.record(z.unknown()),
  durationMs: z.number().int().nonnegative().nullable(),
  error: z.string().min(1).nullable(),
  attempt: z.number().int().nonnegative(),
  at: z.string().datetime()
});
export type AgentHubTraceStep = z.infer<typeof agentHubTraceStepSchema>;

/** Tool results are only meaningful as a child of the tool call they answer. */
export const agentHubTraceRecordInputSchema = z.object({
  stepId: z.string().trim().min(1).max(200),
  parentStepId: z.string().trim().min(1).max(200).optional(),
  type: agentHubStepTypeSchema,
  name: z.string().trim().min(1).max(200).optional(),
  payload: z.record(z.unknown()).optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
  error: z.string().trim().min(1).max(4000).optional(),
  attempt: z.number().int().min(0).max(1000).optional()
}).strict();
export type AgentHubTraceRecordInput = z.infer<typeof agentHubTraceRecordInputSchema>;

/** `type=agent-hub...` query string: comma-separated step types, one optional subtree, one optional agent. */
export const agentHubTraceFiltersSchema = z.object({
  type: z.string().trim().optional(),
  stepId: z.string().trim().min(1).max(200).optional(),
  agentId: z.string().trim().min(1).max(200).optional(),
  depth: z.coerce.number().int().min(0).max(20).optional()
}).transform((value) => ({
  types: value.type
    ? [...new Set(value.type.split(",").map((item) => item.trim()).filter(Boolean))]
    : undefined,
  stepId: value.stepId,
  agentId: value.agentId,
  depth: value.depth
})).superRefine((value, ctx) => {
  for (const item of value.types ?? []) {
    if (!AGENT_HUB_STEP_TYPES.includes(item as AgentHubStepType)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Неизвестный тип шага: ${item}`, path: ["type"] });
    }
  }
});
export type AgentHubTraceFilters = z.infer<typeof agentHubTraceFiltersSchema>;

export type AgentHubTraceNode = AgentHubTraceStep & { children: AgentHubTraceNode[] };

export const agentHubTraceNodeSchema: z.ZodType<AgentHubTraceNode> = z.lazy(() =>
  agentHubTraceStepSchema.extend({ children: z.array(agentHubTraceNodeSchema) })
);

export const agentHubTraceResponseSchema = z.object({
  executionId: z.string().min(1),
  total: z.number().int().nonnegative(),
  steps: z.array(agentHubTraceStepSchema),
  tree: z.array(agentHubTraceNodeSchema),
  truncated: z.boolean()
});
export type AgentHubTraceResponse = z.infer<typeof agentHubTraceResponseSchema>;

export interface AgentHubTraceTreeOptions {
  /** Keep only this step and its descendants — "from the overall graph to one step". */
  rootStepId?: string;
  /** Levels below the roots; 0 = roots only, omitted = everything. */
  depth?: number;
}

/**
 * Builds the step tree from `parentStepId` links, deterministically: children
 * keep chronological order (then `stepId` as a tie-break). Orphans (a parent
 * outside the selected set) become roots, cycles are cut instead of looping, and
 * a step is never attached twice.
 */
export function buildAgentHubTraceTree(
  steps: readonly AgentHubTraceStep[],
  options: AgentHubTraceTreeOptions = {}
): AgentHubTraceNode[] {
  const byId = new Map<string, AgentHubTraceStep>();
  for (const step of steps) if (!byId.has(step.stepId)) byId.set(step.stepId, step);

  const childrenOf = new Map<string, AgentHubTraceStep[]>();
  for (const step of byId.values()) {
    if (!step.parentStepId) continue;
    const bucket = childrenOf.get(step.parentStepId) ?? [];
    bucket.push(step);
    childrenOf.set(step.parentStepId, bucket);
  }
  for (const bucket of childrenOf.values()) {
    bucket.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.stepId.localeCompare(b.stepId));
  }

  const selected = options.rootStepId ? subtreeOf(byId, options.rootStepId) : byId;
  const seen = new Set<string>();
  const limit = options.depth;

  const build = (step: AgentHubTraceStep, level: number): AgentHubTraceNode => {
    seen.add(step.stepId);
    const hasDepth = limit === undefined || level < limit;
    const children = hasDepth
      ? (childrenOf.get(step.stepId) ?? []).filter((child) => selected.has(child.stepId) && !seen.has(child.stepId)).map((child) => build(child, level + 1))
      : [];
    return { ...step, children };
  };

  const roots = options.rootStepId
    ? (byId.has(options.rootStepId) ? [byId.get(options.rootStepId)!] : [])
    : [...selected.values()]
      .filter((step) => !step.parentStepId || !selected.has(step.parentStepId))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.stepId.localeCompare(b.stepId));
  return roots.map((root) => build(root, 0));
}

/** The step and everything below it, with a visited guard so a broken link cannot loop. */
function subtreeOf(byId: Map<string, AgentHubTraceStep>, rootStepId: string): Map<string, AgentHubTraceStep> {
  const result = new Map<string, AgentHubTraceStep>();
  const stack = [rootStepId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (result.has(id)) continue;
    const step = byId.get(id);
    if (!step) continue;
    result.set(id, step);
    for (const child of byId.values()) if (child.parentStepId === id) stack.push(child.stepId);
  }
  // A missing root yields an empty subtree, never the whole execution.
  return result;
}

/** Flat list in tree order, useful for a streaming timeline client. */
export function flattenAgentHubTraceTree(nodes: readonly AgentHubTraceNode[]): AgentHubTraceStep[] {
  const out: AgentHubTraceStep[] = [];
  const walk = (list: readonly AgentHubTraceNode[]): void => {
    for (const node of list) {
      const { children, ...step } = node;
      out.push(step);
      walk(children);
    }
  };
  walk(nodes);
  return out;
}
