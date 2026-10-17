"use client";
import { useCore } from "@orion/core-react";
import { DRAFT_BASIS_LABEL, DRAFT_KIND_LABEL, type Draft, type DryRun } from "@orion/shared-types";
import { Button, ConfirmDialog } from "@orion/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { describeError, useUnsavedDraft } from "../../lib/extensions/host-api";

const areaClass = "block w-full min-h-20 rounded-lg border border-border bg-background px-3 py-2 text-sm";
const REVIEW_LABEL = { draft: "Черновик", approved: "Текст одобрен владельцем", rejected: "Отклонён" } as const;

/** Редактор черновика: каждый раздел показывает, на чём он основан. Одобрение ≠ разрешение на отправку. */
export function DraftEditor({ workspaceId: ws, draft, canReview, onClose, onDirtyChange }: { workspaceId: string; draft: Draft; canReview: boolean; onClose: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const { api } = useCore();
  const cache = useQueryClient();
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(draft.sections.map((s) => [s.id, s.text])));
  const [baseline, setBaseline] = useState(draft);
  const [discard, setDiscard] = useState<"close" | "reload" | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dry, setDry] = useState<DryRun | null>(null);
  const dirty = useMemo(() => baseline.sections.some((s) => texts[s.id] !== s.text), [baseline.sections, texts]);
  useEffect(() => { if (dirty) return; setBaseline(draft); setTexts(Object.fromEntries(draft.sections.map((s) => [s.id, s.text]))); setAck(false); }, [draft, dirty]);
  useEffect(() => { onDirtyChange?.(dirty || busy); return () => onDirtyChange?.(false); }, [dirty, busy, onDirtyChange]);
  useUnsavedDraft(dirty);
  const hasManual = draft.sections.some((s) => s.basis === "manual");
  /** Раздел без подтверждённых сведений или с утратившим подтверждение фактом нельзя одобрить (сервер проверяет то же самое). */
  const unapprovable = !draft.text.trim() || draft.sections.some((s) => s.basis === "unverified" || (s.basis === "empty" && !!s.hint));
  const refresh = () => Promise.all([cache.invalidateQueries({ queryKey: ["assistant-drafts", ws, draft.opportunityId] }), cache.invalidateQueries({ queryKey: ["assistant-draft", ws, draft.id] })]);

  async function run(task: () => Promise<Draft | void>) {
    setBusy(true); setError("");
    try { const updated = await task(); await refresh(); if (updated) { setBaseline(updated); setTexts(Object.fromEntries(updated.sections.map((s) => [s.id, s.text]))); } } catch (e) { setError(`${describeError(e)} Введённый текст сохранён в форме.`); } finally { setBusy(false); }
  }
  const save = () => run(async () => { setDry(null); return api.updateAssistantDraft(ws, draft.id, { expectedRevision: baseline.revision, sections: baseline.sections.map((s) => ({ id: s.id, text: texts[s.id] ?? s.text, factIds: s.factIds })) }); });
  const approve = () => run(async () => { setDry(null); await api.approveAssistantDraft(ws, draft.id, { expectedRevision: draft.revision, textHash: draft.textHash, acknowledgeManualSections: ack }); });
  const reject = () => run(async () => { setDry(null); await api.rejectAssistantDraft(ws, draft.id, { expectedRevision: draft.revision }); });
  const dryRun = () => run(async () => { setDry(await api.dryRunAssistantDraft(ws, draft.id)); });

  return <section className="space-y-3 rounded-xl border border-border p-4" aria-label="Редактор черновика">
    <ConfirmDialog open={discard !== null} title={discard === "reload" ? "Загрузить актуальную версию?" : "Закрыть без сохранения?"} description="Несохранённые правки в этом черновике будут потеряны." confirmLabel="Продолжить без сохранения" danger={false} onCancel={() => setDiscard(null)} onConfirm={() => { if (discard === "close") onClose(); else { setBaseline(draft); setTexts(Object.fromEntries(draft.sections.map((s) => [s.id, s.text]))); setAck(false); setError(""); } setDiscard(null); }} />
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-medium">{DRAFT_KIND_LABEL[draft.kind]} · {REVIEW_LABEL[draft.reviewState]}{draft.reviewState === "approved" && !draft.approvalValid ? " (одобрение больше не действует)" : ""}</h4>
      <Button size="sm" variant="ghost" onClick={() => void refresh().catch((e) => setError(describeError(e)))} disabled={busy}>Проверить актуальность</Button>
      <Button size="sm" variant="ghost" onClick={() => dirty ? setDiscard("close") : onClose()} disabled={busy}>Закрыть черновик</Button>
    </div>
    {draft.question && <p className="break-words text-sm">Вопрос: {draft.question}</p>}
    {draft.stale && <p role="status" className="rounded-lg border border-border p-3 text-sm"><strong>Исходные данные изменились:</strong> {draft.staleReasons.join("; ")}. Этот черновик остаётся историей; его нельзя одобрить — подготовьте новый.</p>}
    {dirty && baseline.revision !== draft.revision && <div role="status" className="text-sm"><p>Черновик изменён в другом окне. Ваш текст сохранён в форме; сохранение старой версии будет отклонено.</p><Button variant="outline" disabled={busy} onClick={() => setDiscard("reload")}>Загрузить актуальную версию</Button></div>}
    <p className="text-xs text-muted-foreground">Одобрение текста — это не разрешение на отправку. Внешняя отправка из ORION пока не выполняется.</p>
    <div className="space-y-3">
      {(dirty ? baseline.sections : draft.sections).map((s) => <label key={s.id} className="block space-y-1 text-sm">
        <span className="font-medium">{DRAFT_BASIS_LABEL[s.basis]}</span>
        {s.hint && <span className="block break-words text-xs text-muted-foreground">{s.hint}</span>}
        <textarea className={areaClass} maxLength={4000} value={texts[s.id] ?? ""} disabled={busy || draft.reviewState === "rejected"} onChange={(e) => setTexts((t) => ({ ...t, [s.id]: e.target.value }))} />
      </label>)}
    </div>
    {draft.notes.length > 0 && <div><p className="text-sm font-medium">Заметки для владельца (в текст не входят)</p>
      <ul className="list-disc space-y-1 pl-5 text-xs">{draft.notes.map((n, i) => <li key={i} className="break-words">{n}</li>)}</ul></div>}
    {draft.materials.length > 0 && <p className="text-xs text-muted-foreground">Версия резюме: {draft.materials.map((m) => m.title).join(", ")}</p>}
    {draft.blockers.length > 0 && <div><p className="text-sm font-medium">Что нужно исправить перед одобрением или отправкой</p>
      <ul className="list-disc space-y-1 pl-5 text-xs">{draft.blockers.map((b, i) => <li key={i} className="break-words">{b}</li>)}</ul></div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {canReview && hasManual && draft.reviewState !== "rejected" && !dirty && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />Я проверил(а) разделы, изменённые вручную: они не опираются на подтверждённые факты ассистента.</label>}
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || !dirty || draft.reviewState === "rejected"} onClick={() => void save()}>Сохранить правки</Button>
      {canReview && <Button variant="outline" disabled={busy || dirty || draft.stale || unapprovable || draft.reviewState === "rejected" || draft.approvalValid || (hasManual && !ack)} onClick={() => void approve()}>Одобрить текст</Button>}
      {canReview && draft.reviewState !== "rejected" && <Button variant="outline" disabled={busy || dirty} onClick={() => void reject()}>Отклонить</Button>}
      <Button variant="outline" disabled={busy || dirty} onClick={() => void dryRun()}>Пробный запуск</Button>
    </div>
    {unapprovable && draft.reviewState !== "rejected" && !draft.stale && <p className="text-xs text-muted-foreground">Одобрить нельзя, пока в черновике есть пустые разделы или разделы без подтверждённых сведений: заполните их сами или подтвердите факты в профиле.</p>}
    {dirty && <p className="text-xs text-muted-foreground">Сохраните правки, чтобы одобрить текст или сделать пробный запуск.</p>}
    {dry && <div className="space-y-2 rounded-lg border border-border p-3 text-sm" aria-label="Результат пробного запуска">
      <p className="font-medium">Пробный запуск: ничего не отправлено</p>
      <p className="break-words text-xs">Получатель: {dry.payload.recipient.title}{dry.payload.recipient.organizationName ? ` · ${dry.payload.recipient.organizationName}` : ""}{dry.payload.recipient.url ? ` · ${dry.payload.recipient.url}` : ""}</p>
      <p className="text-xs">Профиль: {dry.payload.profile.displayName}; резюме: {dry.payload.materials.map((m) => m.title).join(", ") || "не выбрано"}</p>
      <pre className="whitespace-pre-wrap break-words text-xs">{dry.payload.text}</pre>
      <p className="break-all text-xs text-muted-foreground">Хэш содержимого: {dry.payloadHash}</p>
      {dry.reviewNotes.length > 0 && <><p className="text-xs font-medium">Замечания, которые владелец должен осознанно принять:</p><ul className="list-disc space-y-1 pl-5 text-xs">{dry.reviewNotes.map((b, i) => <li key={i} className="break-words">{b}</li>)}</ul></>}
      {dry.blockers.length ? <><p className="text-xs font-medium">Почему это нельзя было бы отправить:</p><ul className="list-disc space-y-1 pl-5 text-xs">{dry.blockers.map((b, i) => <li key={i} className="break-words">{b}</li>)}</ul></> : <p className="text-xs">Блокировок не найдено. Отправка всё равно потребует отдельного разрешения владельца.</p>}
      <p className="text-xs text-muted-foreground">{dry.note}</p>
    </div>}
  </section>;
}
