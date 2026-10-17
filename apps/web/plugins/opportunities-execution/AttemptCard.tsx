"use client";
import { useCore } from "@orion/core-react";
import { ATTEMPT_STATE_LABEL, EXECUTION_LIMITS, type Attempt, type Connection } from "@orion/shared-types";
import { Button } from "@orion/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { describeError } from "../../lib/extensions/host-api";

const GRANT_LABEL = { none: "не выдано", active: "действует", consumed: "использовано", revoked: "отозвано", expired: "истекло" } as const;
const EVIDENCE_LABEL: Record<string, string> = { event_id: "Событие HH", message_id: "Сообщение HH", ui_transition: "Переход в интерфейсе HH", screenshot_hash: "Снимок экрана (хэш)", baseline: "Отклик существовал до попытки", owner_attested: "Подтверждено владельцем", note: "Заметка" };

/** Карточка отправки: точное содержимое, хэш, согласование на срок, отмена и сверка. «Согласовано» и «отправлено» — разные состояния. */
export function AttemptCard({ workspaceId: ws, attempt, connection }: { workspaceId: string; attempt: Attempt; connection: Connection | undefined }) {
  const { api } = useCore();
  const cache = useQueryClient();
  const [ttl, setTtl] = useState<number>(EXECUTION_LIMITS.grantDefaultMinutes);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reconcile, setReconcile] = useState<"sent" | "not_sent" | "">("");
  const [note, setNote] = useState("");
  const refresh = () => cache.invalidateQueries({ queryKey: ["execution-attempts", ws] });
  async function run(task: () => Promise<unknown>) { setBusy(true); setError(""); try { await task(); await refresh(); } catch (e) { setError(describeError(e)); } finally { setBusy(false); } }

  const waitingForDevice = attempt.state === "queued" && !!connection && !connection.runnerOnline;
  const canCancel = attempt.state === "awaiting_approval" || attempt.state === "queued" || (attempt.state === "running" && !attempt.submitReserved && !attempt.cancelRequested);
  return <article className="space-y-3 rounded-xl border border-border p-4 text-sm" aria-label={`Отправка: ${attempt.payload.recipient.title}`}>
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="break-words font-medium">{attempt.payload.recipient.title}{attempt.payload.recipient.organizationName ? ` · ${attempt.payload.recipient.organizationName}` : ""}</h3>
      <span className="font-medium" role="status">{ATTEMPT_STATE_LABEL[attempt.state]}</span>
    </header>
    {attempt.invalidated && attempt.state !== "needs_user_action" && ["awaiting_approval", "queued", "running"].includes(attempt.state) && <p role="alert" className="rounded-lg border border-border p-3"><strong>Содержимое изменилось.</strong> {attempt.invalidReasons.join(" ")} Прежнее согласование не действует.</p>}
    {waitingForDevice && <p role="status">Исполнитель не на связи: отправка ждёт устройства и не выполнится сама. Это не ошибка.</p>}
    {attempt.state === "sent_unconfirmed" && <p role="alert" className="rounded-lg border border-border p-3"><strong>Отправка могла произойти.</strong> Повторная отправка запрещена, пока вы не сверите результат на hh.ru.</p>}
    {attempt.message && <p className="break-words text-muted-foreground">{attempt.message}</p>}
    <dl className="grid gap-1 text-xs sm:grid-cols-2">
      <div><dt className="inline text-muted-foreground">Разрешение: </dt><dd className="inline">{GRANT_LABEL[attempt.grant.state]}{attempt.grant.expiresAt && attempt.grant.state === "active" ? ` до ${new Date(attempt.grant.expiresAt).toLocaleTimeString("ru-RU")}` : ""}</dd></div>
      <div><dt className="inline text-muted-foreground">Резюме: </dt><dd className="inline">{attempt.payload.materials.map((m) => m.title).join(", ") || "не выбрано"}</dd></div>
      <div className="break-all sm:col-span-2"><dt className="inline text-muted-foreground">Хэш содержимого: </dt><dd className="inline">{attempt.payloadHash}</dd></div>
      {attempt.payload.recipient.url && <div className="break-all sm:col-span-2"><dt className="inline text-muted-foreground">Получатель: </dt><dd className="inline">{attempt.payload.recipient.url}</dd></div>}
    </dl>
    <details open={attempt.state === "awaiting_approval"}><summary>Точный текст отклика</summary><pre className="whitespace-pre-wrap break-words py-2 text-xs">{attempt.payload.text}</pre></details>
    {attempt.reviewNotes.length > 0 && <div><p className="font-medium">Замечания, которые нужно принять осознанно</p><ul className="list-disc space-y-1 pl-5 text-xs">{attempt.reviewNotes.map((n, i) => <li key={i} className="break-words">{n}</li>)}</ul></div>}

    {attempt.state === "awaiting_approval" && <div className="space-y-2">
      {attempt.reviewNotes.length > 0 && <label className="flex items-start gap-2"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />Я прочитал(а) замечания и всё равно согласую отправку именно этого текста.</label>}
      <label className="block">Срок действия разрешения
        <select className="ml-2 min-h-10 rounded-lg border border-border bg-background px-3" value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
          {[10, 30, 60, 120].map((m) => <option key={m} value={m}>{m} мин</option>)}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">Разрешение относится только к этому тексту, этому резюме и этому адресату и используется один раз. Любая правка делает его недействительным.</p>
    </div>}
    {error && <p role="alert" className="break-words text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2">
      {attempt.state === "awaiting_approval" && <Button disabled={busy || attempt.invalidated || (attempt.reviewNotes.length > 0 && !ack)} onClick={() => void run(() => api.approveAttempt(ws, attempt.id, { expectedRevision: attempt.revision, payloadHash: attempt.payloadHash, ttlMinutes: ttl, acknowledgeReviewNotes: ack }))}>Согласовать отправку</Button>}
      {canCancel && <Button variant="outline" disabled={busy} onClick={() => void run(() => api.cancelAttempt(ws, attempt.id, { expectedRevision: attempt.revision }))}>{attempt.state === "running" ? "Запросить отмену" : "Отменить"}</Button>}
    </div>
    {attempt.state === "sent_unconfirmed" && <fieldset className="space-y-2 rounded-lg border border-border p-3"><legend className="px-1">Сверка на стороне HH</legend>
      <label className="flex gap-2"><input type="radio" name={`rec-${attempt.id}`} checked={reconcile === "sent"} onChange={() => setReconcile("sent")} />Отклик на hh.ru есть</label>
      <label className="flex gap-2"><input type="radio" name={`rec-${attempt.id}`} checked={reconcile === "not_sent"} onChange={() => setReconcile("not_sent")} />Отклика на hh.ru нет</label>
      <label className="block">Пометка (необязательно)<input className="mt-1 block min-h-10 w-full rounded-lg border border-border bg-background px-3" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <Button disabled={busy || !reconcile} onClick={() => void run(() => api.reconcileAttempt(ws, attempt.id, { expectedRevision: attempt.revision, outcome: reconcile as "sent" | "not_sent", ...(note.trim() ? { note: note.trim() } : {}) }))}>Записать результат сверки</Button>
      <p className="text-xs text-muted-foreground">Сверка ничего не отправляет. Если отклика нет, новую отправку нужно создать и согласовать заново.</p>
    </fieldset>}
    {attempt.state === "confirmed" && <p className="text-xs">{attempt.confirmationBasis === "owner_attested" ? "Подтверждено вами при сверке — исполнитель этого не наблюдал." : "Подтверждено исполнителем по событию, привязанному к аккаунту и вакансии."}</p>}
    {attempt.evidence.length > 0 && <details><summary>Доказательства ({attempt.evidence.length})</summary><ul className="space-y-1 py-2 text-xs">{attempt.evidence.map((e, i) => <li key={i} className="break-words">{EVIDENCE_LABEL[e.kind] ?? e.kind} · {new Date(e.at).toLocaleString("ru-RU")}{e.ref ? ` · ${e.ref}` : ""}{e.text ? ` · ${e.text}` : ""}</li>)}</ul></details>}
    <details><summary>Журнал ({attempt.timeline.length})</summary><ul className="space-y-1 py-2 text-xs">{attempt.timeline.map((t, i) => <li key={i} className="break-words">{new Date(t.at).toLocaleString("ru-RU")} · {t.note}</li>)}</ul></details>
  </article>;
}
