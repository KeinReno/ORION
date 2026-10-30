"use client";

import { createModuleClient, workspaceModuleBase } from "@orion/core";
import { useCore, useTasks } from "@orion/core-react";
import { agentHubExecutionSchema, agentHubEventSchema, agentHubReconcileResultSchema, agentHubRuntimeSessionSchema, type AgentHubExecution } from "@orion/shared-types";
import { Button, EmptyState, PanelBody, PanelHeader, PanelShell, Select, Skeleton } from "@orion/ui";
import { Network } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useActiveWorkspace } from "../../lib/use-active-workspace";

const statusLabel: Record<AgentHubExecution["status"], string> = {
  queued: "Ожидает исполнителя", claimed: "Захвачено", working: "В работе", blocked: "Заблокировано",
  review: "Ожидает проверки", done: "Проверено", failed: "Ошибка", canceled: "Запись отменена"
};

export function AgentHubPanel(): React.ReactElement {
  const { api } = useCore();
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const canManage = workspace?.role === "owner" || workspace?.role === "lead";
  const client = () => createModuleClient(api, workspaceModuleBase(workspaceId as string, "agent-hub"));
  const queryClient = useQueryClient();
  const [taskId, setTaskId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const { data: tasks = [] } = useTasks(workspaceId);
  const openTasks = tasks.filter(task => task.status !== "done" && task.status !== "canceled");
  const taskNames = new Map(tasks.map(task => [task.id, task.title]));
  const runs = useQuery({
    queryKey: ["agent-hub", workspaceId, "executions"],
    queryFn: () => client().get("/executions", agentHubExecutionSchema.array()),
    enabled: Boolean(workspaceId), refetchInterval: 30_000
  });
  const sessions = useQuery({
    queryKey: ["agent-hub", workspaceId, "runtime-sessions"],
    queryFn: () => client().get("/runtime-sessions", agentHubRuntimeSessionSchema.array()),
    enabled: Boolean(workspaceId), refetchInterval: 30_000
  });
  const events = useQuery({
    queryKey: ["agent-hub", workspaceId, "events", selectedId],
    queryFn: () => client().get(`/executions/${selectedId}/events`, agentHubEventSchema.array()),
    enabled: Boolean(workspaceId && selectedId)
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["agent-hub", workspaceId] });
  const create = useMutation({
    mutationFn: (id: string) => client().post("/executions", { taskId: id, requestId: crypto.randomUUID() }, agentHubExecutionSchema),
    onSuccess: async run => { setTaskId(""); setSelectedId(run.id); setActionError(""); await refresh(); },
    onError: error => setActionError(error instanceof Error ? error.message : "Не удалось поставить задачу в очередь")
  });
  const cancel = useMutation({
    mutationFn: (run: AgentHubExecution) => client().post(`/executions/${run.id}/cancel`, { expectedRevision: run.revision }, agentHubExecutionSchema),
    onSuccess: async () => { setActionError(""); await refresh(); },
    onError: error => { setActionError(error instanceof Error ? error.message : "Не удалось отменить исполнение"); void refresh(); }
  });
  const reconcile = useMutation({
    mutationFn: () => client().post("/reconcile", {}, agentHubReconcileResultSchema),
    onSuccess: async () => { setActionError(""); await refresh(); },
    onError: error => setActionError(error instanceof Error ? error.message : "Не удалось восстановить просроченные исполнения")
  });
  const selected = runs.data?.find(run => run.id === selectedId);

  return <PanelShell>
    <PanelHeader icon={Network} title="Agent Hub" subtitle="Очередь ручного исполнения и журнал событий" />
    <PanelBody measure="wide">
      {!workspaceId ? workspaceLoading ? <Skeleton className="h-20 w-full" /> :
        <EmptyState icon={Network} title="Нет рабочего пространства" description="Agent Hub работает внутри пространства." /> : <div className="space-y-6">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Поставить задачу в очередь</h2>
          <p className="mt-1 text-xs text-muted-foreground">Исполнение появится в ручной очереди. Агент не запускается автоматически. После отмены Habitat проверяет состояние и останавливает локальный процесс; запись не подтверждает, что процесс уже завершён.</p>
          {canManage ? <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); if (taskId) create.mutate(taskId); }}>
            <label className="min-w-56 flex-1 text-xs">Задача
              <Select className="mt-1 w-full" value={taskId} onChange={event => setTaskId(event.target.value)} required>
                <option value="">Выберите открытую задачу</option>
                {openTasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
              </Select>
            </label>
            <Button type="submit" size="sm" disabled={!taskId || create.isPending}>Поставить в очередь</Button>
          </form> : <p className="mt-2 text-xs text-muted-foreground">Создавать исполнения могут владелец и руководитель пространства.</p>}
          {canManage && openTasks.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">Сначала создайте открытую задачу в разделе «Задачи».</p> : null}
          {actionError ? <p role="alert" className="mt-2 text-xs text-red-500">{actionError}</p> : null}
        </div>
        <section aria-label="Исполнения" className="space-y-2">
          <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">Исполнения</h2>
            {canManage ? <Button variant="subtle" size="sm" disabled={reconcile.isPending} onClick={() => reconcile.mutate()}>Восстановить просроченные</Button> : null}
          </div>
          {runs.isLoading ? <Skeleton className="h-24 w-full" /> : runs.isError ?
            <EmptyState icon={Network} tone="danger" title="Не удалось загрузить исполнения" description="Проверьте соединение и доступ к модулю." /> :
            (runs.data?.length ?? 0) === 0 ? <EmptyState icon={Network} title="Исполнений пока нет" description="Выберите открытую задачу и поставьте её в ручную очередь." /> :
            runs.data?.map(run => <article key={run.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0"><h3 className="truncate text-sm font-medium">{taskNames.get(run.target.id) ?? `Задача ${run.target.id}`}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{statusLabel[run.status]} · Попытка {run.attempt} · Обновлено {new Date(run.updatedAt).toLocaleString("ru-RU")}</p></div>
                <div className="flex gap-2"><Button variant="subtle" size="sm" aria-expanded={selectedId === run.id} onClick={() => setSelectedId(selectedId === run.id ? null : run.id)}>События</Button>
                  {canManage && !["done", "failed", "canceled"].includes(run.status) ? <Button variant="danger" size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate(run)}>Запросить отмену</Button> : null}</div>
              </div>
              {run.blockedReason ? <p className="mt-2 text-xs text-muted-foreground">Причина: {run.blockedReason}</p> : null}
              {selectedId === run.id ? <div className="mt-3 border-t border-border pt-3 text-xs">
                {events.isLoading ? "Загрузка событий…" : events.isError ? "Не удалось загрузить события." :
                  events.data?.length ? <ol className="space-y-1">{events.data.map(item => <li key={item.id}>{new Date(item.at).toLocaleString("ru-RU")} · {item.action} · ревизия {item.revision}</li>)}</ol> : "Событий пока нет."}
                {selected?.checkpointRef ? <p className="mt-2">Контрольная точка: {selected.checkpointRef}</p> : null}
                {selected?.evidenceRefs.length ? <p className="mt-2">Ссылки на результат (не проверены): {selected.evidenceRefs.join(", ")}</p> : null}
              </div> : null}
            </article>)}
        </section>
        <section aria-label="Заявленные runtime" className="space-y-2"><h2 className="text-sm font-semibold">Заявленные runtime</h2>
          <p className="text-xs text-muted-foreground">Присутствие сообщает токен наблюдателя. Оно не подтверждает работающую модель.</p>
          {sessions.isLoading ? <Skeleton className="h-12 w-full" /> : sessions.isError ? <p role="alert" className="text-xs">Не удалось загрузить runtime.</p> :
            sessions.data?.length ? <ul className="space-y-1">{sessions.data.map(session => <li key={session.id} className="text-xs">Habitat observer · {session.presence === "recent" ? "недавний сигнал" : session.presence === "stale" ? "сигнал устарел" : "закрыт"} · {new Date(session.lastHeartbeatAt).toLocaleString("ru-RU")}</li>)}</ul> : <p className="text-xs text-muted-foreground">Нет заявленных runtime.</p>}
        </section>
      </div>}
    </PanelBody>
  </PanelShell>;
}
