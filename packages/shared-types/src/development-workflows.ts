import { z } from "zod";

/**
 * Workbench (Architect, задание 11.4): пользовательские процессы — схемы работ
 * из узлов (task/agent/evidence/decision/result) и связей. Граф целиком —
 * пользовательские данные пространства (jsonb), одна запись на процесс; запись
 * процесса заменяет граф транзакционно.
 */

export const workflowNodeTypeSchema = z.enum(["task", "agent", "evidence", "decision", "result"]);
export type WorkflowNodeType = z.infer<typeof workflowNodeTypeSchema>;

export const workflowNodeStatusSchema = z.enum(["pending", "active", "done", "pass", "blocked"]);
export type WorkflowNodeStatus = z.infer<typeof workflowNodeStatusSchema>;

export const workflowNodeSchema = z.object({
  id: z.string().min(1).max(80),
  type: workflowNodeTypeSchema,
  title: z.string().min(1).max(140),
  description: z.string().max(2000),
  /** Имя агента (используется, когда type = "agent"). */
  agentName: z.string().max(255),
  status: workflowNodeStatusSchema,
  x: z.number(),
  y: z.number()
});
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;

export const workflowEdgeKindSchema = z.enum(["flow", "signal"]);
export type WorkflowEdgeKind = z.infer<typeof workflowEdgeKindSchema>;

export const workflowEdgeSchema = z.object({
  id: z.string().min(1).max(80),
  source: z.string().min(1).max(80),
  target: z.string().min(1).max(80),
  kind: workflowEdgeKindSchema
});
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;

export const workflowStatusSchema = z.enum(["draft", "active", "paused", "done"]);
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;

/** Краткая строка списка процессов — без узлов и связей. */
export const workflowSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: workflowStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string()
});
export type WorkflowSummary = z.infer<typeof workflowSummarySchema>;

/** Полный процесс со схемой графа. */
export const workflowSchema = workflowSummarySchema.extend({
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema)
});
export type Workflow = z.infer<typeof workflowSchema>;

export const createWorkflowInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional()
});
export type CreateWorkflowInput = z.infer<typeof createWorkflowInputSchema>;

export const updateWorkflowInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  status: workflowStatusSchema.optional(),
  nodes: z.array(workflowNodeSchema).max(5000),
  edges: z.array(workflowEdgeSchema).max(20000)
});
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowInputSchema>;
