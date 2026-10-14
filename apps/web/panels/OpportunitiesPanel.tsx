"use client";
import { useCore, useOpportunities, useOpportunityMutations } from "@orion/core-react";
import { createOpportunityInputSchema, updateOpportunityInputSchema, OPPORTUNITY_STATUS_LABEL, opportunityStatusSchema, type Opportunity, type OpportunityStatus } from "@orion/shared-types";
import { Button, ConfirmDialog, Input, PanelBody, PanelHeader, PanelShell, Skeleton, useToast } from "@orion/ui";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError } from "@orion/core";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useUnsavedDraft } from "../lib/unsaved-drafts";
import { describeError } from "../lib/error-message";
import { opportunitiesCsv } from "../lib/opportunity-export";
import { ExtensionSlot, useSlotContributions } from "../lib/extensions/slot";

export function OpportunitiesPanel() {
  const { workspace, isLoading } = useActiveWorkspace();
  if (!workspace) return <PanelShell><PanelHeader title="Возможности" /><PanelBody>{isLoading ? <Skeleton className="h-20" /> : <p>Выберите рабочее пространство.</p>}</PanelBody></PanelShell>;
  // Context change unmounts the old editor and its data; no old workspace response is rendered here.
  return <OpportunityWorkspace key={workspace.id} workspaceId={workspace.id} workspaceLabel={workspace.name} canManage={workspace.role === "owner"} />;
}
const selectClass = "min-h-10 max-w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

function OpportunityWorkspace({ workspaceId, workspaceLabel, canManage }: { workspaceId: string; workspaceLabel: string; canManage: boolean }) {
  const views = useSlotContributions("opportunities.views").filter((v) => !v.meta?.ownerOnly || canManage);
  const [tab, setTab] = useState("base"); const [dirty, setDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  useUnsavedDraft(dirty);
  const selected = views.find((v) => v.meta?.tabId === tab); const Component = selected?.component;
  useEffect(() => { if (!dirty) return; const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty]);
  function choose(id: string, discard = false) { if (id === tab) return; if (dirty && !discard) { setPendingTab(id); return; } setPendingTab(null); setDirty(false); setTab(id); }
  return <div className="flex h-full min-h-0 flex-col">
    <ConfirmDialog open={pendingTab !== null} title="Перейти без сохранения?" description="В этом разделе есть несохранённый ввод. При переходе он будет потерян." confirmLabel="Перейти без сохранения" danger={false} onCancel={() => setPendingTab(null)} onConfirm={() => { if (pendingTab) choose(pendingTab, true); }} />
    {!!views.length && <nav aria-label="Разделы возможностей" className="flex flex-wrap gap-2 px-4 py-2"><Button size="sm" variant={!selected ? "primary" : "outline"} aria-pressed={!selected} onClick={() => choose("base")}>Вакансии и заказы</Button>{views.map((v) => <Button key={v.pluginId} size="sm" variant={selected === v ? "primary" : "outline"} aria-pressed={selected === v} onClick={() => choose(v.meta!.tabId)}>{v.meta!.label}</Button>)}</nav>}
    {Component ? <PanelShell><PanelHeader title={selected?.meta?.label ?? "Возможности"} subtitle={workspaceLabel} /><PanelBody><Component workspaceId={workspaceId} workspaceLabel={workspaceLabel} canManage={canManage} onDirtyChange={setDirty} /></PanelBody></PanelShell> : <OpportunityBase workspaceId={workspaceId} onDirtyChange={setDirty} canManage={canManage} />}
  </div>;
}
function OpportunityBase({ workspaceId, onDirtyChange, canManage }: { workspaceId: string; onDirtyChange: (dirty: boolean) => void; canManage: boolean }) {
  const { api } = useCore();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"" | "job" | "contract">("");
  const [status, setStatus] = useState<OpportunityStatus | "">("");
  const [archive, setArchive] = useState(false);
  const [editor, setEditor] = useState<Opportunity | "new" | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingEditor, setPendingEditor] = useState<{ value: Opportunity | "new" | null } | null>(null);
  const [exporting, setExporting] = useState(false);
  useUnsavedDraft(dirty);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  const list = useOpportunities(workspaceId, { query: query || undefined, kind: kind || undefined, status: status || undefined, includeArchived: archive ? "true" : "false" });
  const mutations = useOpportunityMutations(workspaceId);
  function open(value: Opportunity | "new" | null, discard = false) {
    if (dirty && !discard) { setPendingEditor({ value }); return; }
    setPendingEditor(null);
    setDirty(false); setEditor(value);
  }
  async function exportData(format: "json" | "csv") {
    setExporting(true);
    try {
      const items = await api.exportOpportunities(workspaceId);
      const data = format === "csv" ? opportunitiesCsv(items) : JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), workspaceId, items }, null, 2);
      const url = URL.createObjectURL(new Blob([data], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `opportunities.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { toast({ title: "Не удалось экспортировать возможности", description: describeError(error), tone: "danger" }); }
    finally { setExporting(false); }
  }
  return <PanelShell>
    <ConfirmDialog open={pendingEditor !== null} title="Закрыть карточку без сохранения?" description="Введённые изменения будут потеряны." confirmLabel="Продолжить без сохранения" danger={false} onCancel={() => setPendingEditor(null)} onConfirm={() => { if (pendingEditor) open(pendingEditor.value, true); }} />
    <PanelHeader title="Возможности" subtitle="Вакансии и заказы" actions={<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={exporting} onClick={() => void exportData("json")}>Скачать JSON</Button><Button variant="outline" disabled={exporting} onClick={() => void exportData("csv")}>Скачать CSV</Button><Button onClick={() => open("new")}>Добавить возможность</Button></div>} />
    <PanelBody className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Поиск возможностей" placeholder="Название, компания или описание" value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1" />
        <div className="flex gap-1" role="group" aria-label="Вид возможности">{([["", "Все"], ["job", "Вакансии"], ["contract", "Заказы"]] as const).map(([id, label]) => <Button key={id} size="sm" variant={kind === id ? "primary" : "outline"} aria-pressed={kind === id} onClick={() => setKind(id)}>{label}</Button>)}</div>
        <select className={selectClass} aria-label="Фильтр статуса" value={status} onChange={(e) => setStatus(e.target.value as OpportunityStatus | "")}><option value="">Все статусы</option>{opportunityStatusSchema.options.map((s) => <option key={s} value={s}>{OPPORTUNITY_STATUS_LABEL[s]}</option>)}</select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} />Показать архив</label>
      </div>
      {editor && <><OpportunityEditor key={editor === "new" ? "new" : editor.id} opportunity={editor === "new" ? null : editor} workspaceId={workspaceId} onDirty={setDirty} onClose={() => open(null)} onSaved={(row) => { setDirty(false); setEditor(null); toast({ title: `Возможность «${row.title}» сохранена`, tone: "success" }); }} />{editor !== "new" && <ExtensionSlot name="opportunities.details.sections" props={{ workspaceId, opportunity: editor, canManage }} />}</>}
      {list.isLoading ? <Skeleton className="h-24" /> : list.isError ? <div role="alert" className="space-y-2"><p>{describeError(list.error)}</p><Button variant="outline" onClick={() => void list.refetch()}>Повторить загрузку</Button></div> : <>
        {!list.data?.pages[0].items.length && <div className="py-8 text-center text-muted-foreground"><p>{query || kind || status ? "По выбранным фильтрам возможностей нет." : "Добавьте первую вакансию или заказ."}</p>{(query || kind || status) && <Button variant="outline" onClick={() => { setQuery(""); setKind(""); setStatus(""); }}>Сбросить фильтры</Button>}</div>}
        <ul className="divide-y divide-border">{list.data?.pages.flatMap((p) => p.items).map((row) => <li key={row.id} className="flex flex-wrap items-center gap-3 py-3">
          <button className="min-w-0 flex-1 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => open(row)}><span className="block break-words font-medium">{row.title}</span><span className="block break-words text-sm text-muted-foreground">{row.organizationName || "Компания не указана"} · {row.kind === "job" ? "Вакансия" : "Заказ"} · {OPPORTUNITY_STATUS_LABEL[row.status]}{row.archivedAt ? " · В архиве" : ""}</span><span className="block text-xs text-muted-foreground">Источник: {row.sourceType === "manual" ? "Вручную" : row.sourceType} · {row.conditions.city || "Город не указан"}</span></button>
          <Button size="sm" variant="outline" disabled={mutations.update.isPending} onClick={() => mutations.update.mutate({ id: row.id, input: { expectedRevision: row.revision, archivedAt: row.archivedAt ? null : new Date().toISOString() } }, { onError: (error) => toast({ title: "Не удалось изменить архив", description: describeError(error), tone: "danger" }) })}>{row.archivedAt ? "Восстановить" : "В архив"}</Button>
        </li>)}</ul>
        {list.hasNextPage && <Button variant="outline" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Загрузить ещё</Button>}
      </>}
    </PanelBody>
  </PanelShell>;
}

function OpportunityEditor({ opportunity, workspaceId, onDirty, onClose, onSaved }: { opportunity: Opportunity | null; workspaceId: string; onDirty: (dirty: boolean) => void; onClose: () => void; onSaved: (row: Opportunity) => void }) {
  const { api } = useCore();
  const { create, update } = useOpportunityMutations(workspaceId);
  const [error, setError] = useState("");
  const [latest, setLatest] = useState(opportunity);
  const [conflict, setConflict] = useState(false);
  const [value, setValue] = useState(() => ({ kind: opportunity?.kind ?? "job", title: opportunity?.title ?? "", organizationName: opportunity?.organizationName ?? "", description: opportunity?.description ?? "", canonicalUrl: opportunity?.canonicalUrl ?? "", sourceType: opportunity?.sourceType ?? "manual", status: opportunity?.status ?? "new", city: opportunity?.conditions.city ?? "", workFormat: opportunity?.conditions.workFormat ?? "unknown", amountMin: opportunity?.conditions.amountMin?.toString() ?? "", amountMax: opportunity?.conditions.amountMax?.toString() ?? "", currency: opportunity?.conditions.currency ?? "RUB", paymentBasis: opportunity?.conditions.paymentBasis ?? "unknown", taxBasis: opportunity?.conditions.taxBasis ?? "unknown" }));
  const busy = create.isPending || update.isPending;
  function field(key: keyof typeof value, text: string) { setValue((prev) => ({ ...prev, [key]: text })); onDirty(true); }
  async function save(event: FormEvent) {
    event.preventDefault(); setError("");
    const parsed = createOpportunityInputSchema.safeParse({ kind: value.kind, title: value.title, organizationName: value.organizationName, description: value.description, sourceType: value.sourceType, canonicalUrl: value.canonicalUrl.trim() || null, externalId: opportunity?.externalId ?? null, status: value.status, capturedAt: opportunity?.capturedAt ?? null,
      conditions: { ...opportunity?.conditions, city: value.city, workFormat: value.workFormat, amountMin: value.amountMin.trim() ? Number(value.amountMin) : null, amountMax: value.amountMax.trim() ? Number(value.amountMax) : null, currency: value.currency, paymentBasis: value.paymentBasis, taxBasis: value.taxBasis } });
    if (!parsed.success) { setError(parsed.error.issues.map((issue) => issue.message).join(". ")); return; }
    try {
      if (!opportunity) { onSaved(await create.mutateAsync(parsed.data)); return; }
      // Only local edits are patched. After a conflict reload, unrelated remote edits survive.
      const input: { expectedRevision: number; [key: string]: unknown } = { expectedRevision: latest?.revision ?? opportunity.revision };
      for (const [key, data] of Object.entries(parsed.data)) {
        if (key === "conditions") continue;
        if (JSON.stringify(data) !== JSON.stringify(opportunity[key as keyof Opportunity])) input[key] = data;
      }
      const changedConditions = Object.fromEntries(Object.entries(parsed.data.conditions).filter(([key, data]) => JSON.stringify(data) !== JSON.stringify(opportunity.conditions[key as keyof typeof opportunity.conditions])));
      if (Object.keys(changedConditions).length) input.conditions = { ...latest?.conditions, ...changedConditions };
      if (Object.keys(input).length === 1) { onSaved(latest ?? opportunity); return; }
      const row = await update.mutateAsync({ id: opportunity.id, input: updateOpportunityInputSchema.parse(input) }); onSaved(row);
    } catch (err) { setError(describeError(err)); setConflict(err instanceof ApiError && err.status === 409); }
  }
  return <form onSubmit={(e) => void save(e)} onChange={() => onDirty(true)} className="space-y-3 rounded-xl border border-border p-4">
    <h2 className="font-medium">{opportunity ? "Изменить возможность" : "Новая возможность"}</h2>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm">Вид<select className={`${selectClass} block w-full`} value={value.kind} onChange={(e) => field("kind", e.target.value)}><option value="job">Вакансия</option><option value="contract">Заказ</option></select></label>
      <label className="space-y-1 text-sm">Статус<select className={`${selectClass} block w-full`} value={value.status} onChange={(e) => field("status", e.target.value)}>{opportunityStatusSchema.options.map((s) => <option key={s} value={s}>{OPPORTUNITY_STATUS_LABEL[s]}</option>)}</select></label>
      {([["title", "Название"], ["organizationName", "Компания / заказчик"], ["canonicalUrl", "Ссылка на источник"], ["sourceType", "Источник"], ["city", "Город"], ["currency", "Валюта (RUB, USD…)"], ["amountMin", "Сумма от"], ["amountMax", "Сумма до"]] as const).map(([key, label]) => <label key={key} className="space-y-1 text-sm">{label}<Input required={key === "title" || key === "sourceType"} maxLength={key === "canonicalUrl" ? 2000 : 300} value={value[key]} onChange={(e) => field(key, e.target.value)} /></label>)}
      <label className="space-y-1 text-sm">Формат работы<select className={`${selectClass} block w-full`} value={value.workFormat} onChange={(e) => field("workFormat", e.target.value)}><option value="unknown">Не указан</option><option value="remote">Удалённо</option><option value="hybrid">Гибрид</option><option value="office">В офисе</option></select></label>
      <label className="space-y-1 text-sm">Оплата<select className={`${selectClass} block w-full`} value={value.paymentBasis} onChange={(e) => field("paymentBasis", e.target.value)}><option value="unknown">Не указано</option><option value="monthly">За месяц</option><option value="hourly">За час</option><option value="fixed">За заказ</option></select></label>
      <label className="space-y-1 text-sm">Налоги<select className={`${selectClass} block w-full`} value={value.taxBasis} onChange={(e) => field("taxBasis", e.target.value)}><option value="unknown">Не указано</option><option value="net">На руки</option><option value="gross">До налогов</option></select></label>
    </div>
    <label className="block space-y-1 text-sm">Описание<textarea className={`${selectClass} block min-h-36 w-full py-2`} maxLength={50000} value={value.description} onChange={(e) => field("description", e.target.value)} /></label>
    {opportunity?.history.length ? <details className="text-sm"><summary>История изменений ({opportunity.history.length})</summary><ul className="space-y-1 py-2">{opportunity.history.map((h, i) => <li key={i}>{new Date(h.at).toLocaleString("ru-RU")} · {h.action === "created" ? "Создана" : h.action === "archived" ? "В архив" : h.action === "restored" ? "Восстановлена" : "Изменена"} · {OPPORTUNITY_STATUS_LABEL[h.toStatus]}</li>)}</ul></details> : null}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {conflict && opportunity && <Button type="button" variant="outline" onClick={() => void api.getOpportunity(workspaceId, opportunity.id).then((row) => { setLatest(row); setConflict(false); setError(`Загружена версия ${row.revision}: «${row.title}», ${OPPORTUNITY_STATUS_LABEL[row.status]}. Ваш ввод сохранён; повторное сохранение изменит только отредактированные поля.`); }).catch((err) => setError(describeError(err)))}>Обновить версию, сохранив мой ввод</Button>}
    <div className="flex gap-2"><Button type="submit" disabled={busy}>Сохранить возможность</Button><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Закрыть</Button></div>
  </form>;
}
