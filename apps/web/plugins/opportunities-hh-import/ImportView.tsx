"use client";
import { useCore } from "@orion/core-react";
import { classifyHhPath, hhImportPreviewInputSchema, type HhImportRun } from "@orion/shared-types";
import { Button, ConfirmDialog } from "@orion/ui";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { OpportunitiesViewSlotProps } from "../../lib/extensions/contracts";
import { describeError, useUnsavedDraft } from "../../lib/extensions/host-api";
export function ImportView({ workspaceId: ws, workspaceLabel, onDirtyChange }: OpportunitiesViewSlotProps) {
  const { api } = useCore(); const cache = useQueryClient(); const stop = useRef(false); const folder = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<{ path: string; text: string }[]>([]); const [excluded, setExcluded] = useState(0);
  const [profiles, setProfiles] = useState(false); const [history, setHistory] = useState(false); const [ack, setAck] = useState(false);
  const [historyProfileId, setHistoryProfileId] = useState(""); const [run, setRun] = useState<HhImportRun | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [dirty, setDirty] = useState(false);
  const [pendingRun, setPendingRun] = useState<string | null>(null);
  useUnsavedDraft(dirty || busy);
  useEffect(() => { folder.current?.setAttribute("webkitdirectory", ""); }, []);
  useEffect(() => { onDirtyChange(dirty || busy); return () => onDirtyChange(false); }, [dirty, busy, onDirtyChange]);
  useEffect(() => { if (!dirty && !busy) return; const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; }; window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler); }, [dirty, busy]);
  useEffect(() => () => { stop.current = true; }, []);
  const recent = useQuery({ queryKey: ["hh-imports", ws], queryFn: () => api.listHhImports(ws) });
  const profileList = useInfiniteQuery({ queryKey: ["opportunity-profiles", ws, false], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => api.listOpportunityProfiles(ws, pageParam), getNextPageParam: (p) => p.nextCursor ?? undefined, enabled: history });
  function change() { setRun(null); setDirty(true); setError(""); }
  async function select(list: FileList | null) {
    if (!list) return; setBusy(true); change(); setFiles([]); setExcluded(0);
    try {
      const accepted = Array.from(list).filter((file) => ["resume", "vacancy", "history"].includes(classifyHhPath(file.webkitRelativePath || file.name)));
      setExcluded(list.length - accepted.length);
      if (accepted.length > 250) throw new Error("Поддерживаемых файлов больше 250. Выберите небольшую папку или несколько отдельных файлов.");
      let bytes = 0; const data: { path: string; text: string }[] = [];
      for (const file of accepted) { bytes += file.size; if (file.size > 800000 || bytes > 1000000) throw new Error("Пакет больше 1 МБ. Выберите меньше файлов."); data.push({ path: file.webkitRelativePath || file.name, text: await file.text() }); }
      hhImportPreviewInputSchema.parse({ files: data, includeProfiles: profiles, includeHistory: history, historyProfileId: historyProfileId || null, acknowledgeWorkspaceVisibility: true });
      setFiles(data);
    } catch (e) { setError(describeError(e)); } finally { setBusy(false); }
  }
  async function preview() {
    setBusy(true); setError("");
    try { const result = await api.previewHhImport(ws, hhImportPreviewInputSchema.parse({ files, includeProfiles: profiles, includeHistory: history, historyProfileId: historyProfileId.trim() || null, acknowledgeWorkspaceVisibility: ack })); setRun(result); setDirty(false); await recent.refetch(); }
    catch (e) { setError(describeError(e)); } finally { setBusy(false); }
  }
  async function apply() {
    if (!run) return; setBusy(true); stop.current = false; setError("");
    try {
      let current = await api.getHhImport(ws, run.id); setRun(current);
      while (!stop.current && (current.status === "preview" || current.status === "applying")) { current = await api.applyHhImport(ws, current.id, { expectedRevision: current.revision, manifestHash: current.manifestHash }); setRun(current); }
      await Promise.all([recent.refetch(), cache.invalidateQueries({ queryKey: ["opportunities", ws] }), cache.invalidateQueries({ queryKey: ["opportunity-profiles", ws] })]);
    } catch (e) { setError(`${describeError(e)} Уже сохранённые порции остаются. Обновите состояние перед продолжением.`); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!run) return; setBusy(true); setError("");
    try { setRun(await api.cancelHhImport(ws, run.id, { expectedRevision: run.revision, manifestHash: run.manifestHash })); await recent.refetch(); }
    catch (e) { setError(describeError(e)); } finally { setBusy(false); }
  }
  async function load(id: string, discard = false) {
    if (dirty && !discard) { setPendingRun(id); return; }
    setPendingRun(null);
    setBusy(true); setError(""); try { setRun(await api.getHhImport(ws, id)); setDirty(false); setFiles([]); } catch (e) { setError(describeError(e)); } finally { setBusy(false); }
  }
  const active = run?.status === "preview" || run?.status === "applying";
  return <div className="space-y-4">
    <ConfirmDialog open={pendingRun !== null} title="Открыть другой импорт?" description="Текущий выбор файлов ещё не сохранён в предпросмотр. Он будет сброшен." confirmLabel="Открыть импорт" danger={false} onCancel={() => setPendingRun(null)} onConfirm={() => { if (pendingRun) void load(pendingRun, true); }} />
    <p className="text-sm text-muted-foreground">Импорт в «{workspaceLabel}» использует выбранные файлы. Поддерживаются резюме MD/TXT, снимки вакансий и журналы JSON. Скрипты и браузерные сессии исключаются до загрузки. PDF/DOC/RTF пока пропускаются.</p>
    <fieldset disabled={busy} className="space-y-3 rounded-xl border border-border p-4"><legend className="px-1 font-medium">Выбор данных</legend>
      <label className="block text-sm">Папка с материалами HH<input ref={folder} type="file" multiple className="mt-1 block max-w-full text-sm" onChange={(e) => void select(e.target.files)} /></label>
      <label className="block text-sm">Или отдельные файлы<input type="file" multiple accept=".json,.md,.txt" className="mt-1 block max-w-full text-sm" onChange={(e) => void select(e.target.files)} /></label>
      <p className="text-sm">Выбрано поддерживаемых файлов: {files.length}. Исключено / не поддерживается: {excluded}. До 250 файлов и 1 МБ за один пакет.</p>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={profiles} onChange={(e) => { setProfiles(e.target.checked); change(); }} />Добавить профили и версии резюме (нужно включить расширение «Профили»)</label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={history} onChange={(e) => { setHistory(e.target.checked); change(); }} />Добавить исторические записи откликов</label>
      {history && <div className="space-y-2"><label className="block text-sm">Профиль для истории (необязательно)<select className="mt-1 block min-h-10 w-full rounded-lg border border-border bg-background px-3" value={historyProfileId} onChange={(e) => { setHistoryProfileId(e.target.value); change(); }}><option value="">Без профиля</option>{profileList.data?.pages.flatMap((p) => p.items).map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}</select><span className="text-xs text-muted-foreground">Профиль по имени файла не угадывается. Выберите его только если точно знаете, кому принадлежит журнал.</span></label>{profileList.hasNextPage && <Button variant="outline" onClick={() => void profileList.fetchNextPage()}>Ещё профили</Button>}{profileList.isError && <p className="text-xs text-muted-foreground">Профили недоступны: {describeError(profileList.error)}. Историю можно сохранить без профиля.</p>}</div>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} onChange={(e) => { setAck(e.target.checked); change(); }} />Разрешаю сохранить выбранные материалы в этом пространстве с доступом его участников. Журналы импорта доступны владельцу.</label>
      <Button disabled={!ack || !files.length || busy} onClick={() => void preview()}>Подготовить предпросмотр</Button>
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {run && <section className="space-y-3 rounded-xl border border-border p-4"><h2 className="font-medium">{run.status === "applied" ? "Импорт завершён" : run.status === "canceled" ? "Импорт отменён" : "Предпросмотр и сохранение"}</h2>
      <p className="text-sm">Вакансий / снимков: {run.preview.opportunities}; материалов: {run.preview.materials}; записей истории: {run.preview.history}.</p>
      {!!run.preview.candidateNames.length && <p className="text-sm">Профили: {run.preview.candidateNames.join(", ")}</p>}
      <p className="text-xs text-muted-foreground">Применяется сохранённый снимок файлов. После изменения файлов создайте новый предпросмотр. Срок: {new Date(run.expiresAt).toLocaleString("ru-RU")}.</p>
      <details><summary className="text-sm">Примеры записей</summary><ul className="space-y-1 py-2 text-xs">{run.preview.samples.map((s, i) => <li key={i} className="break-words">{s.title} · {s.sourcePath}</li>)}</ul></details>
      {!!run.preview.warnings.length && <details open><summary className="text-sm">Пропуски и замечания ({run.preview.warnings.length})</summary><ul className="space-y-1 py-2 text-xs">{run.preview.warnings.map((w, i) => <li key={i} className="break-words">{w.path}: {w.reason}</li>)}</ul></details>}
      <p className="text-sm" aria-live="polite">Обработано {run.checkpoint} из {run.total}. Новых вакансий: {run.report.opportunitiesCreated}; существующих: {run.report.opportunitiesExisting}; снимков: {run.report.capturesCreated}; профилей: {run.report.profilesCreated}; новых версий: {run.report.materialsCreated}; исторических записей: {run.report.historyCreated}; возможных дублей: {run.report.possibleDuplicates}.</p>
      <p className="text-sm text-muted-foreground">Импорт не отправляет отклики. Историческое «verified» — утверждение старого журнала; факты профиля не подтверждаются автоматически. Отмена останавливает следующие порции, уже сохранённые данные остаются.</p>
      <div className="flex flex-wrap gap-2">{active && <><Button disabled={busy || new Date(run.expiresAt) <= new Date()} onClick={() => void apply()}>{run.checkpoint ? "Продолжить импорт" : "Сохранить выбранные данные"}</Button><Button variant="outline" disabled={busy} onClick={() => void cancel()}>Отменить оставшуюся часть</Button></>}{busy && <Button variant="outline" onClick={() => { stop.current = true; }}>Остановить после текущей порции</Button>}<Button variant="outline" disabled={busy} onClick={() => void load(run.id)}>Обновить состояние</Button></div>
    </section>}
    <section className="space-y-2"><h2 className="font-medium">Последние импорты</h2>{recent.isError && <p role="alert">{describeError(recent.error)}</p>}{recent.data?.map((r) => <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm"><Button size="sm" variant="outline" disabled={busy} onClick={() => void load(r.id)}>{new Date(r.createdAt).toLocaleString("ru-RU")}</Button><span>{({ preview: "Предпросмотр", applying: "Частично сохранён", applied: "Завершён", canceled: "Отменён" })[r.status]} · {r.checkpoint}/{r.total}</span></div>)}</section>
  </div>;
}
