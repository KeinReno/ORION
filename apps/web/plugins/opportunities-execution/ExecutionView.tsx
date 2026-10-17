"use client";
import { useCore } from "@orion/core-react";
import { CONNECTION_STATE_LABEL, EXECUTION_LIMITS, type CreatedConnection } from "@orion/shared-types";
import { Button, ConfirmDialog, Skeleton } from "@orion/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { OpportunitiesViewSlotProps } from "../../lib/extensions/contracts";
import { describeError } from "../../lib/extensions/host-api";
import { AttemptCard } from "./AttemptCard";

const fieldClass = "block w-full min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm";

/** Вкладка «Отправка»: подключение аккаунта HH, согласование конкретных откликов и сверка. Только для владельца пространства. */
export function ExecutionView({ workspaceId: ws, workspaceLabel }: OpportunitiesViewSlotProps) {
  const { api } = useCore();
  const cache = useQueryClient();
  const [profileId, setProfileId] = useState("");
  const [label, setLabel] = useState("");
  const [dailyLimit, setDailyLimit] = useState<number>(EXECUTION_LIMITS.dailyDefault);
  const [interval, setIntervalSec] = useState<number>(EXECUTION_LIMITS.minIntervalDefaultSec);
  const [created, setCreated] = useState<CreatedConnection | null>(null);
  const [draftId, setDraftId] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const connections = useQuery({ queryKey: ["execution-connections", ws], queryFn: () => api.listExecutionConnections(ws), refetchInterval: 8000 });
  const profiles = useQuery({ queryKey: ["execution-profiles", ws], queryFn: () => api.listOpportunityProfiles(ws) });
  const drafts = useQuery({ queryKey: ["execution-drafts", ws], queryFn: () => api.listAssistantDrafts(ws) });
  const attempts = useQuery({ queryKey: ["execution-attempts", ws], queryFn: () => api.listAttempts(ws), refetchInterval: 5000 });
  const linked = (connections.data ?? []).filter((c) => c.state === "linked");
  const ready = (drafts.data?.items ?? []).filter((d) => d.approvalValid && !d.stale && d.reviewState === "approved");
  const refresh = () => Promise.all([cache.invalidateQueries({ queryKey: ["execution-connections", ws] }), cache.invalidateQueries({ queryKey: ["execution-attempts", ws] })]);
  async function run(task: () => Promise<unknown>) { setBusy(true); setError(""); try { await task(); await refresh(); } catch (e) { setError(describeError(e)); } finally { setBusy(false); } }

  const availableProfiles = (profiles.data?.items ?? []).filter((p) => !p.archivedAt && !(connections.data ?? []).some((c) => c.profileId === p.id && c.state !== "revoked"));
  return <div className="space-y-6">
    <ConfirmDialog open={confirmRevoke !== null} title="Отозвать подключение?" description="Исполнитель потеряет доступ, очередь будет отменена, разрешения отозваны. Уже начатая отправка не отменяется. Для новой работы нужно создать подключение заново." confirmLabel="Отозвать подключение" onCancel={() => setConfirmRevoke(null)}
      onConfirm={() => { const id = confirmRevoke; setConfirmRevoke(null); const c = connections.data?.find((x) => x.id === id); if (c) void run(() => api.revokeConnection(ws, c.id, { expectedRevision: c.revision })); }} />
    <p className="text-sm text-muted-foreground">
      «{workspaceLabel}»: отправка откликов на hh.ru выполняется <strong>отдельным локальным исполнителем</strong> на вашем компьютере, под вашим входом на сайт. ORION не хранит пароль HH. Каждый отклик отправляется только после вашего согласования его точного текста, один раз и с лимитами.
      Адаптер для реального сайта HH пока не реализован. В этой версии доступны подготовка, согласование и проверка протокола с имитацией; отправлять реальные отклики из неё пока нельзя.
    </p>
    {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}

    <section className="space-y-3" aria-label="Подключения HH">
      <h2 className="font-medium">Подключения HH</h2>
      {connections.isLoading && <Skeleton className="h-16" />}
      {connections.isError && <p role="alert">{describeError(connections.error)}</p>}
      {!connections.isLoading && !connections.data?.length && <p className="text-sm text-muted-foreground">Подключений нет. Создайте подключение для профиля — оно получит одноразовый код для локального исполнителя.</p>}
      <ul className="space-y-2">
        {connections.data?.map((c) => <li key={c.id} className="space-y-2 rounded-xl border border-border p-4 text-sm">
          <p className="break-words font-medium">{c.accountLabel} · {CONNECTION_STATE_LABEL[c.state]}</p>
          <p className="break-words text-xs text-muted-foreground">
            {c.externalAccountId ? `Аккаунт: ${c.accountDisplay || c.externalAccountId}. ` : ""}Лимит: до {c.dailyLimit} в день, не чаще раза в {c.minIntervalSec} с ({c.timezone}).
            {c.state === "linked" ? (c.runnerOnline ? " Исполнитель на связи." : " Исполнитель не на связи.") : ""}{c.consecutiveFailures ? ` Подряд системных сбоев: ${c.consecutiveFailures}.` : ""}
          </p>
          {c.pausedReason && c.state !== "linked" && <p className="break-words text-xs">{c.pausedReason}</p>}
          <div className="flex flex-wrap gap-2">
            {c.state === "linked" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => api.pauseConnection(ws, c.id, { expectedRevision: c.revision }))}>Приостановить</Button>}
            {c.state === "linked" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => api.stopConnection(ws, c.id, { expectedRevision: c.revision }))}>Остановить всё</Button>}
            {c.state === "paused" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => api.resumeConnection(ws, c.id, { expectedRevision: c.revision }))}>Возобновить</Button>}
            {c.state !== "revoked" && <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmRevoke(c.id)}>Отозвать</Button>}
          </div>
        </li>)}
      </ul>
      {created && <div role="status" className="space-y-2 rounded-xl border border-border p-4 text-sm">
        <p className="font-medium">Код сопряжения для локального исполнителя (показывается один раз)</p>
        <p className="break-all font-mono text-xs">{created.pairingCode}</p>
        <p className="text-xs text-muted-foreground">Действует до {new Date(created.pairingExpiresAt).toLocaleTimeString("ru-RU")}. Введите его в локальном исполнителе после ручного входа на hh.ru. Исполнитель сам сообщит, какой аккаунт открыт; пароль и коды из СМС в ORION не передаются.</p>
        <Button size="sm" variant="outline" onClick={() => setCreated(null)}>Скрыть код</Button>
      </div>}
      <form className="space-y-3 rounded-xl border border-border p-4" onSubmit={(e) => { e.preventDefault(); void run(async () => { setCreated(await api.createExecutionConnection(ws, { profileId, accountLabel: label.trim(), dailyLimit, minIntervalSec: interval, timezone: "Europe/Moscow" })); setLabel(""); }); }}>
        <h3 className="font-medium">Новое подключение</h3>
        <label className="block text-sm">Профиль<select required className={fieldClass} value={profileId} onChange={(e) => setProfileId(e.target.value)}><option value="">Выберите профиль</option>{availableProfiles.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}</select></label>
        <label className="block text-sm">Название аккаунта (для вас)<input required maxLength={120} className={fieldClass} value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">Не больше откликов в день<input type="number" min={1} max={EXECUTION_LIMITS.dailyMax} className={fieldClass} value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} /></label>
          <label className="block text-sm">Минимальный интервал, с<input type="number" min={EXECUTION_LIMITS.minIntervalMinSec} max={EXECUTION_LIMITS.minIntervalMaxSec} className={fieldClass} value={interval} onChange={(e) => setIntervalSec(Number(e.target.value))} /></label>
        </div>
        <Button type="submit" disabled={busy || !profileId || !label.trim()}>Создать подключение</Button>
      </form>
    </section>

    <section className="space-y-3" aria-label="Новая отправка">
      <h2 className="font-medium">Новая отправка</h2>
      <p className="text-xs text-muted-foreground">Отправить можно только одобренный и актуальный черновик отклика на вакансию HH с числовым идентификатором. Подготовка отправки ничего не отправляет: после неё нужно отдельное согласование.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Одобренный черновик
          <select className={fieldClass} value={draftId} onChange={(e) => setDraftId(e.target.value)}>
            <option value="">{ready.length ? "Выберите черновик" : "Нет одобренных актуальных черновиков"}</option>
            {ready.map((d) => <option key={d.id} value={d.id}>{d.sections.find((s) => s.id === "s-intro")?.text ?? d.id} · {new Date(d.createdAt).toLocaleDateString("ru-RU")}</option>)}
          </select>
        </label>
        <label className="block text-sm">Подключённый аккаунт
          <select className={fieldClass} value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
            <option value="">{linked.length ? "Выберите аккаунт" : "Нет подключённых аккаунтов"}</option>
            {linked.map((c) => <option key={c.id} value={c.id}>{c.accountLabel}</option>)}
          </select>
        </label>
      </div>
      <Button disabled={busy || !draftId || !connectionId} onClick={() => void run(async () => { await api.createAttempt(ws, { draftId, connectionId, idempotencyKey: `ui-${draftId}-${connectionId}`.slice(0, 80) }); setDraftId(""); })}>Подготовить отправку</Button>
    </section>

    <section className="space-y-3" aria-label="Отправки">
      <h2 className="font-medium">Отправки</h2>
      {attempts.isLoading && <Skeleton className="h-24" />}
      {attempts.isError && <p role="alert">{describeError(attempts.error)} <Button size="sm" variant="outline" onClick={() => void attempts.refetch()}>Повторить</Button></p>}
      {!attempts.isLoading && !attempts.data?.items.length && <p className="text-sm text-muted-foreground">Отправок пока нет.</p>}
      <div className="space-y-3">{attempts.data?.items.map((a) => <AttemptCard key={a.id} workspaceId={ws} attempt={a} connection={connections.data?.find((c) => c.id === a.connectionId)} />)}</div>
    </section>
  </div>;
}
