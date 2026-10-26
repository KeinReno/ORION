import type { Prisma } from "@prisma/client";
import type { Task, CreateTaskInput, UpdateTaskInput } from "@orion/shared-types";

/** Public task operations. Tx commands require the caller's authorization and RLS context. */
export abstract class TaskOperations {
  abstract list(userId: string, workspaceId: string, search?: string, assignedToMe?: boolean): Promise<Task[]>;
  abstract create(userId: string, workspaceId: string, input: CreateTaskInput, agentName?: string): Promise<Task>;
  abstract createTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, input: CreateTaskInput): Promise<{ id: string }>;
  abstract createFromAgentTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, input: CreateTaskInput, agentName: string): Promise<{ id: string }>;
  abstract update(userId: string, workspaceId: string, taskId: string, input: UpdateTaskInput, agentName?: string): Promise<Task>;
  abstract remove(userId: string, workspaceId: string, taskId: string): Promise<void>;
}
