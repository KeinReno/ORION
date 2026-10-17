"use client";
import { useCore } from "@orion/core-react";
import { MANAGER_ACTION_LABEL, MANAGER_LIMITS, POLICY_STATE_LABEL, type Policy } from "@orion/shared-types";
import { Button, ConfirmDialog, Skeleton } from "@orion/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { OpportunitiesViewSlotProps } from "../../lib/extensions/contracts";
import { describeError } from "../../lib/extensions/host-api";

const fieldClass = "block w-full min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm";
const ATTEMPT_LABEL: Record<string, string> = {
  confirmed: "подтверждено", queued: "ждут исполнителя", running: "выполняются", sent_unconfirmed: "ждут сверки", canceled: "отменено", failed_before_send: "не отправлено (ошибка)",
  already_exists: "отклик уже существовал", needs_user_action: "нужно действие человека", awaiting_approval: "ждут согласования", rejected: "отклонено"
};

/** Вкладка «Менеджер»: явная политика автономности, запуск цикла по команде, пауза/остановка и отчёт. Полномочия сами не растут. */
export function ManagerView({ workspaceId: ws, workspaceLabel }: OpportunitiesViewSlotProps) {
  const { api } = useCore();
  const cache = useQueryClient();
  const [connectionId, setConnectionId] = useState("");
  const [minScore, setMinScore] = useState<number>(MANAGER_LIMITS.scoreDefault);
  const [dailyLimit, setDailyLimit] = useState<number>(MANAGER_LIMITS.dailyDefault);
  const [maxTotal, setMaxTotal] = useState<number>(MANAGER_LIMITS.totalDefault);
  const [days, setDays] = useState<number>(MANAGER_LIMITS.expiryDefaultDays);
  const [quiet, setQuiet] = useState(false);
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("08:00");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmStop, setConfirmStop] = useState<Policy | null>(null);

  const policies = useQuery({ queryKey: ["manager-policies", ws], queryFn: () => api.listManagerPolicies(ws), refetchInterval: 10000 });
  const connections = useQuery({ queryKey: ["execution-connections", ws], queryFn: () => api.listExecutionConnections(ws) });
  const live = policies.data?.find((p) => p.state === "active" || p.state === "paused");
  const report = useQuery({ queryKey: ["manager-report", ws, live?.id], enabled: !!live, queryFn: () => api.managerPolicyReport(ws, live!.id), refetchInterval: 10000 });
  const free = (connections.data ?? []).filter((c) => c.state === "linked" && !policies.data?.some((p) => p.connectionId === c.id && (p.state === "active" || p.state === "paused")));
  const refresh = () => Promise.all([cache.invalidateQueries({ queryKey: ["manager-policies", ws] }), cache.invalidateQueries({ queryKey: ["manager-report", ws] }), cache.invalidateQueries({ queryKey: ["execution-attempts", ws] })]);
  async function run(task: () => Promise<unknown>) { setBusy(true); setError(""); setNotice(""); try { await task(); await refresh(); } catch (e) { setError(describeError(e)); } finally { setBusy(false); } }

  return <div className="space-y-6">
    <ConfirmDialog open={confirmStop !== null} title="Остановить политику насовсем?" description="Менеджер перестанет работать, неначатые отправки по политике будут отменены, разрешения отозваны. Уже начатая отправка не отменяется. Возобновить остановленную политику нельзя — нужно создать новую." confirmLabel="Остановить политику"
      onCancel={() => setConfirmStop(null)} onConfirm={() => { const p = confirmStop; setConfirmStop(null); if (p) void run(() => api.stopManagerPolicy(ws, p.id, { expectedRevision: p.revision })); }} />
    <p className="text-sm text-muted-foreground">
      «{workspaceLabel}»: менеджер сам ставит в очередь отправки <strong>только</strong> по вашей политике — с лимитами, сроком и порогами. Он не расширяет свои права, не принимает офферы и не придумывает опыт: текст собирается из подтверждённых фактов,
      любое сомнение уходит вам на решение. Цикл запускается только кнопкой — фонового запуска нет. Каждая отправка всё равно проходит проверки исполнителя и лимиты аккаунта.
    </p>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="break-words text-sm">{notice}</p>}

    {policies.isLoading && <Skeleton className="h-24" />}
    {policies.isError && <p role="alert">{describeError(policies.error)}</p>}

    {live && <section className="space-y-3 rounded-xl border border-border p-4 text-sm" aria-label="Действующая политика">
      <h2 className="font-medium">Политика: {POLICY_STATE_LABEL[live.state]}</h2>
      {live.pausedReason && <p className="break-words">{live.pausedReason}</p>}
      <ul className="space-y-1 text-xs">
        <li>Порог рейтинга: от {live.minScore}, надёжность данных не ниже «{live.minConfidence === "high" ? "высокая" : "средняя"}»{live.requiredFactIds.length ? `, обязательных фактов: ${live.requiredFactIds.length}` : ""}.</li>
        <li>В день не больше {live.dailyLimit}; всего осталось действий: {live.remaining} из {live.maxTotal}.{live.quietHours ? ` Тихие часы: ${live.quietHours.start}–${live.quietHours.end} (${live.timezone}).` : ""}</li>
        <li>Действует до {new Date(live.expiresAt).toLocaleString("ru-RU")}.</li>
      </ul>
      <div className="flex flex-wrap gap-2">
        {live.state === "active" && <Button disabled={busy} onClick={() => void run(async () => { const r = await api.runManagerPolicy(ws, live.id); setNotice(`Цикл завершён: в очередь ${r.queued}, пропущено ${r.skipped}, на ваше решение ${r.needsReview}, ошибок ${r.failed}.${r.stoppedReason ? ` Остановка: ${r.stoppedReason}` : ""}`); })}>Запустить цикл</Button>}
        {live.state === "active" && <Button variant="outline" disabled={busy} onClick={() => void run(() => api.pauseManagerPolicy(ws, live.id, { expectedRevision: live.revision }))}>Приостановить</Button>}
        {live.state === "paused" && <Button variant="outline" disabled={busy} onClick={() => void run(() => api.resumeManagerPolicy(ws, live.id, { expectedRevision: live.revision }))}>Возобновить</Button>}
        <Button variant="outline" disabled={busy} onClick={() => setConfirmStop(live)}>Остановить насовсем</Button>
      </div>
    </section>}

    {report.data && <section className="space-y-3" aria-label="Отчёт менеджера">
      <h2 className="font-medium">Отчёт</h2>
      <p className="text-sm" aria-live="polite">
        В очередь поставлено: {report.data.totals.queued}; пропущено: {report.data.totals.skipped}; на ваше решение: {report.data.totals.needsReview}; ошибок: {report.data.totals.failed}. Сегодня поставлено {report.data.today.queued} из {report.data.today.limit}.
      </p>
      {Object.keys(report.data.attemptsByState).length > 0 && <p className="text-sm">Итог отправок по политике: {Object.entries(report.data.attemptsByState).map(([state, n]) => `${ATTEMPT_LABEL[state] ?? state}: ${n}`).join("; ")}.</p>}
      {!report.data.actions.length && <p className="text-sm text-muted-foreground">Менеджер ещё ничего не делал. Нажмите «Запустить цикл».</p>}
      <ul className="space-y-2">
        {report.data.actions.map((a) => <li key={a.id} className="space-y-1 rounded-lg border border-border p-3 text-sm">
          <p className="break-words font-medium">{a.opportunityTitle} · {MANAGER_ACTION_LABEL[a.state]}</p>
          <p className="break-words text-xs text-muted-foreground">{a.reason}</p>
          {a.details.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs">{a.details.map((d, i) => <li key={i} className="break-words">{d}</li>)}</ul>}
        </li>)}
      </ul>
    </section>}

    {!live && !policies.isLoading && <form className="space-y-3 rounded-xl border border-border p-4" onSubmit={(e) => {
      e.preventDefault();
      void run(async () => { await api.createManagerPolicy(ws, { connectionId, minScore, minConfidence: "medium", requiredFactIds: [], dailyLimit, maxTotal, quietHours: quiet ? { start: quietStart, end: quietEnd } : null, expiresInDays: days, acknowledgeAutonomy: true }); setAck(false); });
    }}>
      <h2 className="font-medium">Новая политика автономности</h2>
      <p className="text-xs text-muted-foreground">По умолчанию менеджер выключен. Политика действует ограниченное время и на один подключённый аккаунт. Расширить её нельзя — только остановить и создать новую.</p>
      <label className="block text-sm">Подключённый аккаунт HH
        <select required className={fieldClass} value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
          <option value="">{free.length ? "Выберите аккаунт" : "Нет свободных подключённых аккаунтов"}</option>
          {free.map((c) => <option key={c.id} value={c.id}>{c.accountLabel}</option>)}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Порог рейтинга (от {MANAGER_LIMITS.scoreMin})<input type="number" min={MANAGER_LIMITS.scoreMin} max={100} className={fieldClass} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} /></label>
        <label className="block text-sm">Не больше в день (до {MANAGER_LIMITS.dailyMax})<input type="number" min={1} max={MANAGER_LIMITS.dailyMax} className={fieldClass} value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} /></label>
        <label className="block text-sm">Всего действий (до {MANAGER_LIMITS.totalMax})<input type="number" min={1} max={MANAGER_LIMITS.totalMax} className={fieldClass} value={maxTotal} onChange={(e) => setMaxTotal(Number(e.target.value))} /></label>
        <label className="block text-sm">Срок действия, дней (до {MANAGER_LIMITS.expiryMaxDays})<input type="number" min={1} max={MANAGER_LIMITS.expiryMaxDays} className={fieldClass} value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />Тихие часы: ничего не ставить в очередь</label>
      {quiet && <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">С<input type="time" className={fieldClass} value={quietStart} onChange={(e) => setQuietStart(e.target.value)} /></label><label className="block text-sm">До<input type="time" className={fieldClass} value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} /></label></div>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />Я понимаю: в пределах этой политики менеджер сам согласует и поставит в очередь отправки откликов от моего имени, не показывая мне каждый текст заранее. Остановить его можно в любой момент.</label>
      <Button type="submit" disabled={busy || !ack || !connectionId}>Включить менеджера</Button>
    </form>}
  </div>;
}
