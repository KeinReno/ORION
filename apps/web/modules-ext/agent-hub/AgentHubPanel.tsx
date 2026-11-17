"use client";

import { createModuleClient, workspaceModuleBase } from "@orion/core";
import { useAgentAuditLog, useCore, useTasks } from "@orion/core-react";
import { AGENT_AUDIT_RESULT_LABEL, agentAuditResultOf, agentHubDelegationPolicySchema, agentHubExecutionSchema, agentHubEventSchema, agentHubReconcileResultSchema, agentHubRuntimeSessionSchema, type AgentHubDelegationPolicy, type AgentHubExecution, type AgentAuditResult } from "@orion/shared-types";
import { Button, EmptyState, PanelBody, PanelHeader, PanelShell, Skeleton } from "@orion/ui";
import { Network } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChoiceSelect } from "../../components/choice-select";
import { shortDateTime } from "../../lib/format";
import { openSettings } from "../../lib/panel-bus";
import { useActiveWorkspace } from "../../lib/use-active-workspace";

const statusLabel: Record<AgentHubExecution["status"], string> = {
  queued: "Ожидает исполнителя", claimed: "Захвачено", working: "В работе", blocked: "Заблокировано",
  waiting_approval: "Ждёт подтверждения", review: "Ожидает проверки", done: "Проверено",
  failed: "Ошибка", canceled: "Запись отменена", reassigned: "Переназначено"
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
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
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
  // P3-4: последние вызовы агентов (полный журнал с фильтрами, отменой и CSV — в Настройки → ИИ → Журнал).
  const audit = useAgentAuditLog(workspaceId, { limit: 10 });
  const auditTone: Record<AgentAuditResult, string> = {
    ok: "text-muted-foreground",
    proposed: "text-warning",
    denied: "text-danger",
    limited: "text-danger",
    error: "text-danger"
  };
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
  // P3-1: политика подтверждений — кому нужно человеческое решение.
  const policy = useQuery({
    queryKey: ["agent-hub", workspaceId, "policy"],
    queryFn: () => client().get("/policy", agentHubDelegationPolicySchema),
    enabled: Boolean(workspaceId && canManage)
  });
  const approve = useMutation({
    mutationFn: (run: AgentHubExecution) => client().post(`/executions/${run.id}/approve`, { expectedRevision: run.revision }, agentHubExecutionSchema),
    onSuccess: async () => { setActionError(""); setRejectFor(null); await refresh(); },
    onError: error => { setActionError(error instanceof Error ? error.message : "Не удалось одобрить"); void refresh(); }
  });
  const reject = useMutation({
    mutationFn: (run: AgentHubExecution) => client().post(`/executions/${run.id}/reject`, { expectedRevision: run.revision, reason: rejectReason.trim() || "Отклонено владельцем" }, agentHubExecutionSchema),
    onSuccess: async () => { setActionError(""); setRejectFor(null); setRejectReason(""); await refresh(); },
    onError: error => { setActionError(error instanceof Error ? error.message : "Не удалось отклонить"); void refresh(); }
  });
  const setApprovals = useMutation({
    mutationFn: (approvals: AgentHubDelegationPolicy["approvals"]) => client().put("/policy", { maxDelegationDepth: policy.data?.maxDelegationDepth ?? 3, approvals }, agentHubDelegationPolicySchema),
    onSuccess: async () => { setActionError(""); await queryClient.invalidateQueries({ queryKey: ["agent-hub", workspaceId, "policy"] }); },
    onError: error => setActionError(error instanceof Error ? error.message : "Не удалось изменить политику подтверждений")
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
            <div className="min-w-56 flex-1 text-xs">Задача
              <ChoiceSelect
                className="mt-1"
                label="Задача"
                value={taskId}
                options={[{ value: "", label: "Выберите открытую задачу" }, ...openTasks.map((task) => ({ value: task.id, label: task.title }))]}
                onChange={setTaskId}
              />
            </div>
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
              {run.status === "waiting_approval" && run.approval ? <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                <p className="font-medium">Запрошено подтверждение: {run.approval.action}</p>
                <p className="mt-1 text-muted-foreground">{run.approval.reason}</p>
                <p className="mt-1 text-muted-foreground">{run.approval.requestedBy} · {new Date(run.approval.requestedAt).toLocaleString("ru-RU")}</p>
                {canManage ? <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button size="sm" disabled={approve.isPending || reject.isPending} onClick={() => approve.mutate(run)}>Одобрить</Button>
                  <Button variant="danger" size="sm" disabled={approve.isPending || reject.isPending} onClick={() => setRejectFor(rejectFor === run.id ? null : run.id)}>Отклонить</Button>
                  {rejectFor === run.id ? <span className="flex min-w-56 flex-1 items-center gap-2">
                    <input
                      className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1"
                      placeholder="Причина отказа"
                      value={rejectReason}
                      onChange={event => setRejectReason(event.target.value)}
                    />
                    <Button variant="danger" size="sm" disabled={reject.isPending} onClick={() => reject.mutate(run)}>Подтвердить отказ</Button>
                  </span> : null}
                </div> : <p className="mt-2 text-muted-foreground">Решение принимает владелец или руководитель пространства.</p>}
              </div> : null}
              {selectedId === run.id ? <div className="mt-3 border-t border-border pt-3 text-xs">
                {events.isLoading ? "Загрузка событий…" : events.isError ? "Не удалось загрузить события." :
                  events.data?.length ? <ol className="space-y-1">{events.data.map(item => <li key={item.id}>{new Date(item.at).toLocaleString("ru-RU")} · {item.action} · ревизия {item.revision}</li>)}</ol> : "Событий пока нет."}
                {selected?.checkpointRef ? <p className="mt-2">Контрольная точка: {selected.checkpointRef}</p> : null}
                {selected?.evidenceRefs.length ? <p className="mt-2">Ссылки на результат (не проверены): {selected.evidenceRefs.join(", ")}</p> : null}
              </div> : null}
            </article>)}
        </section>
        <section aria-label="Подтверждения агентов" className="space-y-2">
          <h2 className="text-sm font-semibold">Подтверждения агентов</h2>
          <p className="text-xs text-muted-foreground">Агент останавливается и ждёт вашего решения перед операцией выше чтения. Администраторы (режим токена «admin») действуют без подтверждений, если политика не требует иначе.</p>
          {canManage ? policy.isLoading ? <Skeleton className="h-10 w-full" /> : policy.isError ? <p role="alert" className="text-xs">Не удалось загрузить политику.</p> :
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span>Требовать подтверждение:</span>
              <ChoiceSelect
                className="min-w-56"
                label="Политика подтверждений"
                value={policy.data?.approvals ?? "non_admin"}
                options={[
                  { value: "non_admin", label: "Только агентам ниже администратора" },
                  { value: "all", label: "Каждому агенту" }
                ]}
                onChange={value => setApprovals.mutate(value as AgentHubDelegationPolicy["approvals"])}
              />
            </div> : null}
        </section>
        <section aria-label="Последние действия агентов" className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Последние действия агентов</h2>
            <Button variant="subtle" size="sm" onClick={() => openSettings("agents")}>Полный журнал</Button>
          </div>
          <p className="text-xs text-muted-foreground">Что агенты делали в этом пространстве: каждый вызов — одна строка. Фильтры, отмена созданного и выгрузка CSV — в журнале настроек.</p>
          {audit.isLoading ? <Skeleton className="h-16 w-full" /> : audit.isError ? <p role="alert" className="text-xs">Не удалось загрузить журнал.</p> :
            (audit.data?.length ?? 0) === 0 ? <p className="text-xs text-muted-foreground">Вызовов пока не было.</p> :
            <ul className="space-y-1">{audit.data?.map(entry => {
              const result = agentAuditResultOf(entry.status);
              return (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="shrink-0 text-muted-foreground">{shortDateTime(entry.createdAt)}</span>
                  <span className="shrink-0 font-medium">{entry.tokenName}</span>
                  <span className="min-w-0 flex-1 truncate">{entry.summary ?? entry.action}</span>
                  <span className={`shrink-0 ${auditTone[result]}`}>{AGENT_AUDIT_RESULT_LABEL[result]}</span>
                </li>
              );
            })}</ul>}
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
