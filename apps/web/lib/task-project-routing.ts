"use client";

import { useCore } from "@orion/core-react";
import type { Task } from "@orion/shared-types";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { setTaskProjectResolver } from "./panel-bus";
import { useActiveWorkspace } from "./use-active-workspace";
import { useEnabledModules } from "./use-enabled-modules";

/**
 * Teaches `openEntity("task", id)` where a task lives: a task of a project opens inside that project (its tab, «Задачи»),
 * from anywhere — search, dashboard, links, notifications — and only a task without a project opens in Tasks.
 *
 * The project comes from the task lists already loaded (`["tasks", workspaceId, …]`); a task that is not there yet (just
 * created from the inbox, a list item) refetches the list once. Navigation only: the project tab loads the task through
 * its own access-checked API.
 */
export function useTaskProjectRouting(): void {
  const { api } = useCore();
  const queryClient = useQueryClient();
  const { workspace } = useActiveWorkspace();
  const { isEnabled } = useEnabledModules();
  const workspaceId = workspace?.id;
  const projectsOn = isEnabled("projects");

  useEffect(() => {
    if (!workspaceId || !projectsOn) {
      setTaskProjectResolver(null);
      return;
    }
    const cached = (taskId: string): Task | undefined => {
      for (const [, tasks] of queryClient.getQueriesData<Task[]>({ queryKey: ["tasks", workspaceId] })) {
        const found = Array.isArray(tasks) ? tasks.find((task) => task.id === taskId) : undefined;
        if (found) return found;
      }
      return undefined;
    };
    setTaskProjectResolver(async (taskId) => {
      const known = cached(taskId);
      if (known) return known.projectId ?? null;
      const tasks = await queryClient.fetchQuery({
        queryKey: ["tasks", workspaceId, "", false],
        queryFn: () => api.listTasks(workspaceId),
        staleTime: 0
      });
      return tasks.find((task) => task.id === taskId)?.projectId ?? null;
    });
    return () => setTaskProjectResolver(null);
  }, [api, queryClient, workspaceId, projectsOn]);
}
