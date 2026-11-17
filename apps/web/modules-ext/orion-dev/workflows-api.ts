import { createModuleClient, workspaceModuleBase, type ModuleRequester } from "@orion/core";
import { z } from "zod";
import {
  workflowNodeSchema,
  workflowEdgeSchema,
  workflowSummarySchema,
  workflowSchema,
  createWorkflowInputSchema,
  updateWorkflowInputSchema,
  type WorkflowNode,
  type WorkflowEdge,
  type WorkflowSummary,
  type Workflow,
  type WorkflowNodeType,
  type WorkflowNodeStatus,
  type WorkflowStatus,
  type WorkflowEdgeKind,
  type CreateWorkflowInput,
  type UpdateWorkflowInput
} from "@orion/shared-types";

export {
  workflowNodeSchema,
  workflowEdgeSchema,
  workflowSummarySchema,
  workflowSchema,
  type WorkflowNode,
  type WorkflowEdge,
  type WorkflowSummary,
  type Workflow,
  type WorkflowNodeType,
  type WorkflowNodeStatus,
  type WorkflowStatus,
  type WorkflowEdgeKind
};

/** Ответ POST /workflows — 201 { id }. */
export const workflowCreatedSchema = z.object({ id: z.string() });

/** Тело POST /workflows. */
export const workflowCreateSchema = createWorkflowInputSchema;

/** Тело PUT /workflows/:id. */
export const workflowUpdateSchema = updateWorkflowInputSchema;

export type WorkflowCreateInput = CreateWorkflowInput;
export type WorkflowUpdateInput = UpdateWorkflowInput;

export interface WorkflowsClient {
  list(): Promise<WorkflowSummary[]>;
  create(input: WorkflowCreateInput): Promise<{ id: string }>;
  get(id: string): Promise<Workflow>;
  update(id: string, input: WorkflowUpdateInput): Promise<Workflow>;
  remove(id: string): Promise<unknown>;
}

/** Контракт: workspaces/:workspaceId/development/workflows. */
export function createWorkflowsClient(api: ModuleRequester, workspaceId: string): WorkflowsClient {
  const client = createModuleClient(api, workspaceModuleBase(workspaceId, "development"));
  return {
    list: () => client.get("/workflows", workflowSummarySchema.array()),
    create: input => client.post("/workflows", input, workflowCreatedSchema),
    get: id => client.get<Workflow>(`/workflows/${encodeURIComponent(id)}`, workflowSchema),
    update: (id, input) => client.put<Workflow>(`/workflows/${encodeURIComponent(id)}`, input, workflowSchema),
    remove: id => client.delete(`/workflows/${encodeURIComponent(id)}`, z.unknown())
  };
}
