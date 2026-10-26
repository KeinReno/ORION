"use client";

import type { CreateTaskInput, Task, UpdateTaskInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";
import { fromReplica, useHybridReplica } from "./use-replica";

/**
 * `search` (optional) switches to the server's full-text query instead of
 * the plain list (see TasksService.list) — pass a debounced value, since
 * each distinct string is its own cached query and fires its own request.
 */
export function useTasks(workspaceId: string | undefined, search?: string, assignedToMe?: boolean) {
  const { api } = useCore();
  const replica = useHybridReplica(workspaceId);
  const fromCopy = Boolean(replica) && !(search && search.trim()) && !assignedToMe;
  const query = useQuery<Task[]>({
    queryKey: ["tasks", workspaceId, search ?? "", assignedToMe ?? false],
    queryFn: () => api.listTasks(workspaceId as string, search, assignedToMe),
    enabled: Boolean(workspaceId) && !fromCopy,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false
  });
  if (replica && fromCopy) return fromReplica(query, replica, replica.engine.tasks());
  return query;
}

const TASK_SYNC_FIELDS = ["title", "description", "status", "priority", "dueAt", "startAt", "estimatedMinutes", "sortOrder"] as const;

function onlySyncFields(input: Record<string, unknown>, allowed: readonly string[], ignored: readonly string[] = []): boolean {
  return Object.keys(input).every((key) => input[key] === undefined || allowed.includes(key) || ignored.includes(key));
}

/** Оставляет только то, что реально отличается от копии: редактор шлёт запись целиком, а офлайн-операции нужны точечные. */
function changedOnly(input: Record<string, unknown>, local: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => value !== undefined && key !== "expectedRevision" && JSON.stringify(value) !== JSON.stringify(local[key]))
  );
}

function pick(input: Record<string, unknown>, allowed: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => allowed.includes(key) && value !== undefined));
}

export function useCreateTask(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  const replica = useHybridReplica(workspaceId);
  return useMutation({
    // Гибрид: запись идёт в локальную очередь и без сети — react-query не должен приостанавливать её до появления связи.
    networkMode: replica ? "always" : "online",
    mutationFn: async (input: CreateTaskInput): Promise<Task> => {
      if (replica && onlySyncFields({ ...input }, TASK_SYNC_FIELDS)) {
        const op = await replica.engine.enqueue({ entity: "task", kind: "create", fields: pick({ ...input }, TASK_SYNC_FIELDS) });
        void replica.engine.sync();
        return replica.engine.tasks().find((task) => task.id === op.entityId) as Task;
      }
      return api.createTask(workspaceId as string, input);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId] })
  });
}

export function useUpdateTask(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  const replica = useHybridReplica(workspaceId);
  return useMutation({
    // Гибрид: запись идёт в локальную очередь и без сети — react-query не должен приостанавливать её до появления связи.
    networkMode: replica ? "always" : "online",
    mutationFn: async ({ taskId, input }: { taskId: string; input: UpdateTaskInput }): Promise<Task> => {
      const local = replica?.engine.tasks().find((task) => task.id === taskId);
      const changed = local ? changedOnly({ ...input }, local as unknown as Record<string, unknown>) : {};
      if (replica && local && onlySyncFields(changed, TASK_SYNC_FIELDS)) {
        if (Object.keys(changed).length === 0) return local;
        await replica.engine.enqueue({
          entity: "task",
          kind: "patch",
          entityId: taskId,
          fields: changed,
          ...(input.expectedRevision !== undefined ? { expectedRevision: input.expectedRevision } : {})
        });
        void replica.engine.sync();
        return replica.engine.tasks().find((task) => task.id === taskId) as Task;
      }
      return api.updateTask(workspaceId as string, taskId, input);
    },
    onSuccess: (_task, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId] });
      if (vars.input.status !== undefined) {
        void queryClient.invalidateQueries({ queryKey: ["time-running", workspaceId] });
        void queryClient.invalidateQueries({ queryKey: ["time", workspaceId] });
      }
    }
  });
}

export function useDeleteTask(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  const replica = useHybridReplica(workspaceId);
  return useMutation({
    // Гибрид: запись идёт в локальную очередь и без сети — react-query не должен приостанавливать её до появления связи.
    networkMode: replica ? "always" : "online",
    mutationFn: async (taskId: string): Promise<void> => {
      if (replica) {
        await replica.engine.enqueue({ entity: "task", kind: "delete", entityId: taskId });
        void replica.engine.sync();
        return;
      }
      return api.deleteTask(workspaceId as string, taskId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId] })
  });
}
