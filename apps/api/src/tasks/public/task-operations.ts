import type { Prisma } from "@prisma/client";
import type { Task, CreateTaskInput, UpdateTaskInput } from "@orion/shared-types";

/** Снимок полей задачи, нужный копированию структуры (задание 03). Не DTO: без счётчиков и связей. */
export type ProjectTaskSnapshot = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  estimatedMinutes: number | null;
  startAt: Date | null;
  dueAt: Date | null;
  milestoneId: string | null;
  sortOrder: number;
};

/** Public task operations. Tx commands require the caller's authorization and RLS context. */
export abstract class TaskOperations {
  abstract list(userId: string, workspaceId: string, search?: string, assignedToMe?: boolean): Promise<Task[]>;
  /**
   * Задачи проекта в ЧУЖОЙ транзакции — для копирования структуры (`projects/:id/duplicate`).
   * Модуль projects не читает `tasks` напрямую (G4); вызывающий уже держит транзакцию и RLS.
   */
  abstract listByProjectTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string): Promise<ProjectTaskSnapshot[]>;
  abstract create(userId: string, workspaceId: string, input: CreateTaskInput, agentName?: string): Promise<Task>;
  abstract createTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, input: CreateTaskInput): Promise<{ id: string }>;
  abstract createFromAgentTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, input: CreateTaskInput, agentName: string): Promise<{ id: string }>;
  abstract updateTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, taskId: string, input: UpdateTaskInput, agentName?: string): Promise<{ id: string }>;
  abstract update(userId: string, workspaceId: string, taskId: string, input: UpdateTaskInput, agentName?: string): Promise<Task>;
  abstract remove(userId: string, workspaceId: string, taskId: string): Promise<void>;
}
