"use client";

import { ApiError, createModuleClient, workspaceModuleBase } from "@orion/core";
import { useCore } from "@orion/core-react";
import {
  agentHubAgentProfilesResponseSchema,
  agentHubAgentProfileSchema,
  agentHubBindAgentCredentialsInputSchema,
  agentHubCreateAgentProfileInputSchema,
  agentHubCredentialOptionsResponseSchema,
  agentHubSetTaskAssignmentInputSchema,
  agentHubTaskAssignmentSchema,
  type AgentHubCredentialOption
} from "@orion/shared-types";
import { Button, Combobox, Input, Modal, Skeleton, useToast } from "@orion/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { SlotContracts } from "../../lib/extensions/contracts";

export function AgentHubTaskAssignmentAction({ workspaceId, task, canManage, open, onClose }: SlotContracts["tasks.context.actions"]): React.ReactElement | null {
  const { api } = useCore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [credentialIds, setCredentialIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const client = () => createModuleClient(api, workspaceModuleBase(workspaceId as string, "agent-hub"));

  const assignment = useQuery({
    queryKey: ["agent-hub", workspaceId, "task-assignment", task.id],
    queryFn: () => client().get(`/task-assignments/${task.id}`, agentHubTaskAssignmentSchema),
    enabled: open && Boolean(workspaceId)
  });
  const agents = useQuery({
    queryKey: ["agent-hub", workspaceId, "agents"],
    queryFn: () => client().get("/agents", agentHubAgentProfilesResponseSchema),
    enabled: open && Boolean(workspaceId)
  });
  const credentials = useQuery({
    queryKey: ["agent-hub", workspaceId, "agent-credentials"],
    queryFn: () => client().get("/agent-credentials", agentHubCredentialOptionsResponseSchema),
    enabled: open && Boolean(workspaceId)
  });

  const activeCredentials = useMemo(
    () => (credentials.data?.credentials ?? []).filter((credential) => !credential.expiresAt || new Date(credential.expiresAt).getTime() > Date.now()),
    [credentials.data]
  );
  const setAssignment = useMutation({
    mutationFn: (agentId: string | null) => client().put(`/task-assignments/${task.id}`, agentHubSetTaskAssignmentInputSchema.parse({ agentId }), agentHubTaskAssignmentSchema),
    onSuccess: async (result) => {
      setFormError(null);
      toast({ title: result.agent ? `Назначен ИИ-агент «${result.agent.name}»` : "Назначение ИИ-агента снято", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["agent-hub", workspaceId] });
      onClose();
    },
    onError: (error) => setFormError(describeAgentHubError(error))
  });
  const createAndAssign = useMutation({
    mutationFn: async () => {
      const input = agentHubCreateAgentProfileInputSchema.parse({ name: agentName, credentialIds });
      const profile = await client().post("/agents", input, agentHubAgentProfileSchema);
      try {
        return await client().put(`/task-assignments/${task.id}`, agentHubSetTaskAssignmentInputSchema.parse({ agentId: profile.id }), agentHubTaskAssignmentSchema);
      } catch (error) {
        throw new Error(`Профиль «${profile.name}» создан, но назначить его не удалось: ${describeAgentHubError(error)}`);
      }
    },
    onSuccess: async () => {
      setFormError(null);
      toast({ title: "Профиль агента создан и назначен", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["agent-hub", workspaceId] });
      onClose();
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : describeAgentHubError(error));
      void queryClient.invalidateQueries({ queryKey: ["agent-hub", workspaceId, "agents"] });
    }
  });
  const rebindAndAssign = useMutation({
    mutationFn: async () => {
      const input = agentHubBindAgentCredentialsInputSchema.parse({ credentialIds });
      const profile = await client().put(`/agents/${selectedAgentId}/credentials`, input, agentHubAgentProfileSchema);
      try {
        return await client().put(`/task-assignments/${task.id}`, agentHubSetTaskAssignmentInputSchema.parse({ agentId: profile.id }), agentHubTaskAssignmentSchema);
      } catch (error) {
        throw new Error(`Credentials профиля «${profile.name}» обновлены, но назначить его не удалось: ${describeAgentHubError(error)}`);
      }
    },
    onSuccess: async () => {
      setFormError(null);
      toast({ title: "Credential обновлена, ИИ-агент назначен", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["agent-hub", workspaceId] });
      onClose();
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : describeAgentHubError(error));
      void queryClient.invalidateQueries({ queryKey: ["agent-hub", workspaceId, "agents"] });
    }
  });
  const busy = setAssignment.isPending || createAndAssign.isPending || rebindAndAssign.isPending;

  useEffect(() => {
    if (!open) return;
    setSelectedAgentId(assignment.data?.agent?.id ?? "");
    setAgentName("");
    setCredentialIds([]);
    setFormError(null);
  }, [open, assignment.data?.taskId, assignment.data?.agent?.id]);

  if (!open) return null;

  const activeAgent = assignment.data?.agent;
  const agentOptions = [
    { value: "", label: "Не назначен" },
    ...(activeAgent && !agents.data?.agents.some((agent) => agent.id === activeAgent.id)
      ? [{ value: activeAgent.id, label: `${activeAgent.name} (профиль недоступен)` }]
      : []),
    ...(agents.data?.agents ?? []).map((agent) => ({
      value: agent.id,
      label: agent.credentialStatus === "active" ? agent.name : `${agent.name} · ${credentialStatusLabel(agent.credentialStatus)}`
    }))
  ];
  const selectedAgent = agents.data?.agents.find((agent) => agent.id === selectedAgentId);
  const queryError = assignment.error ?? agents.error ?? credentials.error;
  const loading = assignment.isLoading || agents.isLoading || credentials.isLoading;
  const retry = (): void => {
    void assignment.refetch();
    void agents.refetch();
    void credentials.refetch();
  };

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      title="Исполнитель задачи"
      description={`Назначение задачи «${task.title}» только фиксирует ответственного. Запуск выполнения в Agent Hub — отдельное действие.`}
      size="md"
      footer={(
        <div className="flex flex-wrap justify-between gap-2">
          <Button type="button" variant="subtle" disabled={busy} onClick={onClose}>Закрыть</Button>
          <div className="flex flex-wrap justify-end gap-2">
            {assignment.data?.agent ? <Button type="button" variant="subtle" disabled={!canManage || busy} onClick={() => { setFormError(null); setAssignment.mutate(null); }}>Снять назначение</Button> : null}
            <Button type="button" disabled={!canManage || busy || loading || Boolean(queryError) || !workspaceId || selectedAgentId === assignment.data?.agent?.id} onClick={() => { setFormError(null); setAssignment.mutate(selectedAgentId || null); }}>
              {setAssignment.isPending ? "Сохраняю…" : "Сохранить"}
            </Button>
          </div>
        </div>
      )}
    >
      <div className="space-y-4">
        {!workspaceId ? <p role="alert" className="text-label text-destructive">Не удалось определить пространство. Назначение не изменено.</p> : null}
        {!canManage ? <p role="status" className="text-label text-subtle-foreground">Назначать ИИ-агентов могут владелец или руководитель пространства.</p> : null}
        {loading ? <Skeleton className="h-24 w-full" /> : null}
        {queryError ? (
          <div className="space-y-2 rounded-lg border border-destructive/40 p-3" role="alert">
            <p className="text-label text-destructive">{describeAgentHubError(queryError)}</p>
            <Button type="button" variant="subtle" size="sm" onClick={retry}>Повторить загрузку</Button>
          </div>
        ) : null}
        {!loading && !queryError ? (
          <>
            {assignment.data?.agent && assignment.data.credentialStatus !== "active" ? (
              <p role="status" className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-label text-warning">
                «{assignment.data.agent.name}» остаётся назначенным, но подключённые credentials {assignment.data.credentialStatus === "revoked" ? "отозваны" : assignment.data.credentialStatus === "expired" ? "истекли" : assignment.data.credentialStatus === "unavailable" ? "принадлежат другому участнику и недоступны для просмотра" : "недоступны"}. Выберите действующий профиль или снимите назначение.
              </p>
            ) : null}
            {selectedAgent && selectedAgent.credentialStatus !== "active" ? (
              <p role="status" className="text-label text-warning">{selectedAgent.credentialStatus === "unavailable" ? `Состояние credentials профиля «${selectedAgent.name}» скрыто: они принадлежат другому участнику. Вы можете выбрать этот профиль или назначить другой.` : `Для профиля «${selectedAgent.name}» требуется повторно привязать действующую credential (${selectedAgent.credentialStatus}).`}</p>
            ) : null}
            <Combobox
              label="ИИ-агент"
              items={agentOptions.map(({ value, label }) => ({ id: value, label }))}
              value={selectedAgentId || null}
              onChange={setSelectedAgentId}
            />
            {agents.data?.agents.length === 0 ? <p className="text-label text-subtle-foreground">Профилей пока нет. Создайте его из своей действующей учётной записи агента.</p> : null}
            {selectedAgent && selectedAgent.credentialStatus !== "active" && selectedAgent.credentialStatus !== "unavailable" ? (
              <fieldset className="space-y-3 rounded-lg border border-warning/40 p-3">
                <legend className="px-1 text-label font-medium">Перепривязать свои credentials</legend>
                <CredentialPicker credentials={activeCredentials} selected={credentialIds} onChange={setCredentialIds} />
                <Button type="button" size="sm" disabled={!canManage || busy || loading || Boolean(queryError) || credentialIds.length === 0} onClick={() => { setFormError(null); rebindAndAssign.mutate(); }}>
                  {rebindAndAssign.isPending ? "Перепривязываю…" : "Перепривязать и назначить"}
                </Button>
              </fieldset>
            ) : null}
            <details open={agents.data?.agents.length === 0} className="rounded-lg border border-border p-3">
              <summary className="cursor-pointer text-label font-medium">Создать профиль и назначить</summary>
              <div className="mt-3 space-y-3">
              <Input value={agentName} onChange={(event) => setAgentName(event.target.value)} maxLength={100} placeholder="Название профиля" aria-label="Название профиля агента" />
              {activeCredentials.length === 0 ? (
                <p className="text-label text-subtle-foreground">Нет действующих credentials, принадлежащих вам. Создайте или подключите учётную запись в настройках ИИ-агентов.</p>
              ) : (
                <CredentialPicker credentials={activeCredentials} selected={credentialIds} onChange={setCredentialIds} />
              )}
              <Button type="button" size="sm" disabled={!canManage || busy || loading || Boolean(queryError) || !agentName.trim() || credentialIds.length === 0} onClick={() => { setFormError(null); createAndAssign.mutate(); }}>
                {createAndAssign.isPending ? "Создаю и назначаю…" : "Создать профиль и назначить"}
              </Button>
              </div>
            </details>
          </>
        ) : null}
        {formError ? <p role="alert" className="text-label text-destructive">{formError}</p> : null}
      </div>
    </Modal>
  );
}

function describeAgentHubError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return "Нет доступа. Назначать ИИ-агентов могут владелец и руководитель пространства.";
    if (error.status === 404) return "Agent Hub или задача недоступны. Проверьте, что модуль включён и задача существует.";
    return error.message || "Не удалось выполнить действие с ИИ-агентом.";
  }
  if (error instanceof TypeError) return "Нет связи с сервером. Проверьте подключение и повторите попытку.";
  return error instanceof Error ? error.message : "Не удалось выполнить действие с ИИ-агентом.";
}

function credentialStatusLabel(status: "active" | "revoked" | "expired" | "missing" | "unavailable"): string {
  switch (status) {
    case "active": return "активен";
    case "revoked": return "credential отозвана";
    case "expired": return "credential истекла";
    case "missing": return "нет credential";
    case "unavailable": return "недоступен";
  }
}

function CredentialPicker({
  credentials,
  selected,
  onChange
}: {
  credentials: AgentHubCredentialOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}): React.ReactElement {
  if (credentials.length === 0) return <p className="text-label text-subtle-foreground">Нет действующих credentials, принадлежащих вам. Создайте или подключите учётную запись в настройках ИИ-агентов.</p>;
  return (
    <div className="space-y-2" aria-label="Выберите credentials">
      {credentials.map((credential) => (
        <label key={credential.id} className="flex items-start gap-2 text-label">
          <input
            type="checkbox"
            checked={selected.includes(credential.id)}
            onChange={(event) => onChange(event.target.checked ? [...selected, credential.id] : selected.filter((id) => id !== credential.id))}
            className="mt-0.5 accent-accent"
          />
          <span className="min-w-0">
            <span className="block font-medium">{credential.name}</span>
            <span className="block text-micro text-subtle-foreground">Права: {credential.scopes.length ? credential.scopes.join(", ") : "не указаны"}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
