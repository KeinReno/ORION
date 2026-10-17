"use client";
import { useCore } from "@orion/core-react";
import { DRAFT_KIND_LABEL, type Draft } from "@orion/shared-types";
import { Button, Skeleton } from "@orion/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { OpportunitiesDetailsSlotProps } from "../../lib/extensions/contracts";
import { describeError, useUnsavedDraft } from "../../lib/extensions/host-api";
import { AssessmentView } from "./AssessmentView";
import { DraftEditor } from "./DraftEditor";

const fieldClass = "block w-full min-h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm";

/** Раздел карточки возможности: оценка по выбранному профилю, черновики и пробный запуск. Данные никуда не уходят. */
export function AssistantSection({ workspaceId: ws, opportunity, canManage, onDirtyChange }: OpportunitiesDetailsSlotProps) {
  const { api } = useCore();
  const cache = useQueryClient();
  const [profileId, setProfileId] = useState("");
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draftDirty, setDraftDirty] = useState(false);
  const dirty = draftDirty || !!question.trim() || busy;
  useUnsavedDraft(dirty);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);

  const status = useQuery({ queryKey: ["assistant-status", ws], queryFn: () => api.getAssistantStatus(ws) });
  const profiles = useQuery({ queryKey: ["assistant-profiles", ws], queryFn: () => api.listOpportunityProfiles(ws) });
  const items = useMemo(() => profiles.data?.items ?? [], [profiles.data]);
  useEffect(() => { if (!profileId && items.length) setProfileId(items[0].id); }, [items, profileId]);
  const assessments = useQuery({
    queryKey: ["assistant-assessments", ws, opportunity.id, profileId], enabled: !!profileId,
    queryFn: () => api.listAssessments(ws, { opportunityId: opportunity.id, profileId })
  });
  const drafts = useQuery({ queryKey: ["assistant-drafts", ws, opportunity.id], queryFn: () => api.listAssistantDrafts(ws, { opportunityId: opportunity.id }) });
  const latest = assessments.data?.items[0];
  const openDraft: Draft | undefined = drafts.data?.items.find((d) => d.id === openDraftId);
  const archived = !!opportunity.archivedAt;

  async function run(task: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await task(); } catch (e) { setError(describeError(e)); } finally { setBusy(false); }
  }
  const assess = () => run(async () => { await api.assessOpportunity(ws, { opportunityId: opportunity.id, profileId, provider: "rules-v1" }); await cache.invalidateQueries({ queryKey: ["assistant-assessments", ws, opportunity.id] }); });
  const draft = (kind: "response" | "proposal" | "answer") => run(async () => {
    const created = await api.createAssistantDraft(ws, { opportunityId: opportunity.id, profileId, kind, ...(kind === "answer" ? { question: question.trim() } : {}) });
    if (kind === "answer") setQuestion(""); setOpenDraftId(created.id);
    await Promise.all([cache.invalidateQueries({ queryKey: ["assistant-drafts", ws, opportunity.id] }), cache.invalidateQueries({ queryKey: ["assistant-assessments", ws, opportunity.id] })]);
  });

  if (profiles.isError) return <section className="rounded-xl border border-border p-4 text-sm" aria-label="Ассистент"><h3 className="font-medium">Ассистент</h3><p role="alert">{describeError(profiles.error)}. Для оценки нужны включённые «Профили кандидатов».</p></section>;
  const mainKind = opportunity.kind === "contract" ? "proposal" : "response";

  return <section className="space-y-3 rounded-xl border border-border p-4 text-sm" aria-label="Ассистент">
    <h3 className="font-medium">Ассистент: оценка и черновики</h3>
    <p className="text-xs text-muted-foreground">
      {status.data?.providers.find((p) => p.available)?.label ?? "Локальные правила"}: сопоставление с подтверждёнными фактами профиля по общим словам. ИИ-модель не подключена, данные никуда не передаются, ничего не отправляется.
    </p>
    {profiles.isLoading ? <Skeleton className="h-16" /> : !items.length ? <p>Нет профилей. Создайте профиль и подтвердите его факты на вкладке «Профили».</p> : <>
      <label className="block">Профиль
        <select className={fieldClass} disabled={draftDirty || busy} value={profileId} onChange={(e) => { setProfileId(e.target.value); setOpenDraftId(null); }}>
          {items.map((p) => <option key={p.id} value={p.id}>{p.displayName}{p.archivedAt ? " (архив)" : ""}</option>)}
        </select>
      </label>
      {archived && <p role="status">Карточка в архиве: оценки и черновики недоступны. Восстановите карточку.</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !profileId || archived} onClick={() => void assess()}>{latest ? (latest.stale ? "Пересчитать оценку" : "Оценить заново") : "Оценить соответствие"}</Button>
        <Button variant="outline" disabled={busy || draftDirty || !profileId || archived} onClick={() => void draft(mainKind)}>{mainKind === "proposal" ? "Подготовить предложение" : "Подготовить отклик"}</Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">Вопрос из анкеты работодателя
          <input className={fieldClass} maxLength={1000} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Например: есть ли опыт работы с BPMN?" />
        </label>
        <Button variant="outline" disabled={busy || draftDirty || !profileId || archived || question.trim().length < 3} onClick={() => void draft("answer")}>Подготовить ответ</Button>
      </div>
      {assessments.isLoading && <Skeleton className="h-24" />}
      {assessments.isError && <p role="alert">{describeError(assessments.error)}</p>}
      {latest ? <AssessmentView assessment={latest} /> : !assessments.isLoading && <p className="text-xs text-muted-foreground">Оценки по этому профилю ещё нет. Она покажет, что подтверждено фактами, где пробелы и что неизвестно.</p>}
      <div className="space-y-2">
        <h4 className="font-medium">Черновики ({drafts.data?.items.length ?? 0})</h4>
        {drafts.isError && <p role="alert">{describeError(drafts.error)}</p>}
        {!drafts.isLoading && !drafts.data?.items.length && <p className="text-xs text-muted-foreground">Черновиков нет. Текст собирается только из подтверждённых фактов; пробелы остаются пустыми.</p>}
        <ul className="space-y-1">
          {drafts.data?.items.map((d) => <li key={d.id} className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={draftDirty || busy} variant={openDraftId === d.id ? "primary" : "outline"} aria-pressed={openDraftId === d.id} onClick={() => setOpenDraftId(openDraftId === d.id ? null : d.id)}>{DRAFT_KIND_LABEL[d.kind]} · {new Date(d.createdAt).toLocaleString("ru-RU")}</Button>
            <span className="text-xs text-muted-foreground">{d.reviewState === "approved" ? (d.approvalValid ? "одобрен" : "одобрение недействительно") : d.reviewState === "rejected" ? "отклонён" : "черновик"}{d.stale ? " · устарел" : ""}</span>
          </li>)}
        </ul>
      </div>
      {openDraft && <DraftEditor key={openDraft.id} workspaceId={ws} draft={openDraft} canReview={canManage} onDirtyChange={setDraftDirty} onClose={() => setOpenDraftId(null)} />}
    </>}
  </section>;
}
