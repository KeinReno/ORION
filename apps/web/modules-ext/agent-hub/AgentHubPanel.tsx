"use client";

import { createModuleClient, workspaceModuleBase } from "@orion/core";
import { useCore } from "@orion/core-react";
import { agentHubExecutionSchema, type AgentHubExecution } from "@orion/shared-types";
import { EmptyState, PanelBody, PanelHeader, PanelShell, Skeleton } from "@orion/ui";
import { Network } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useActiveWorkspace } from "../../lib/use-active-workspace";

/** Read-only first-wave board. An empty queue is not an online/working agent. */
export function AgentHubPanel(): React.ReactElement {
  const { api } = useCore();
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const runs = useQuery<AgentHubExecution[]>({
    queryKey: ["agent-hub", workspaceId, "executions"],
    queryFn: () => createModuleClient(api, workspaceModuleBase(workspaceId as string, "agent-hub"))
      .get("/executions", agentHubExecutionSchema.array()),
    enabled: Boolean(workspaceId)
  });

  return (
    <PanelShell>
      <PanelHeader icon={Network} title="Agent Hub" subtitle="Исполнения и история заданий · управление runtime ещё не подключено" />
      <PanelBody measure="wide">
        {!workspaceId ? (
          workspaceLoading ? <Skeleton className="h-20 w-full" /> :
          <EmptyState icon={Network} title="Нет рабочего пространства" description="Agent Hub работает внутри пространства." />
        ) : runs.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : runs.isError ? (
          <EmptyState icon={Network} tone="danger" title="Не удалось загрузить исполнения" description="Проверьте соединение и доступ к модулю." />
        ) : (runs.data?.length ?? 0) === 0 ? (
          <EmptyState icon={Network} title="Исполнений пока нет" description="На этом этапе доступны только записи исполнения. Автоматический запуск агентов и координация IDE ещё не включены." />
        ) : (
          <div className="space-y-2">
            {(runs.data ?? []).map((run) => (
              <article key={run.id} className="rounded-lg border border-border bg-card px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">Задача {run.target.id}</div>
                    <div className="mt-1 text-xs text-muted-foreground">Попытка {run.attempt} · Ревизия {run.revision}</div>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">{run.status}</span>
                </div>
                {run.blockedReason ? <p className="mt-2 text-xs text-muted-foreground">{run.blockedReason}</p> : null}
              </article>
            ))}
          </div>
        )}
      </PanelBody>
    </PanelShell>
  );
}
