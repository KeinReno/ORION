"use client";
import { ApiError } from "@orion/core";
import { useCore } from "@orion/core-react";
import { classifyHhPath, hhImportPreviewInputSchema, type HhImportRun } from "@orion/shared-types";
import { Button, ConfirmDialog } from "@orion/ui";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { OpportunitiesViewSlotProps } from "../../lib/extensions/contracts";
import { describeError, useUnsavedDraft } from "../../lib/extensions/host-api";
import { HistoryLog } from "./HistoryLog";
import { PACKAGE_LIMITS, SUPPORTED_KINDS, buildParts, checkPackageSize, groupWarnings, type PackageIssue, type PickedFile } from "./batching";
import type { PdfjsLike } from "./document-text";

type Warning = { path: string; reason: string; code?: string };

/** pdf.js грузится только когда в пакете есть PDF; воркер — статический файл приложения (как в просмотре файлов). */
async function loadBrowserPdfjs(): Promise<{ pdfjs: PdfjsLike; version: string }> {
  const module = await import("pdfjs-dist");
  module.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  return { pdfjs: module as unknown as PdfjsLike, version: module.version };
}

const STATUS_LABEL = { preview: "Предпросмотр", applying: "Частично сохранён", applied: "Завершён", canceled: "Отменён" } as const;

export function ImportView({ workspaceId: ws, workspaceLabel, onDirtyChange }: OpportunitiesViewSlotProps) {
  const { api } = useCore();
  const cache = useQueryClient();
  const stop = useRef(false);
  const folder = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [excluded, setExcluded] = useState(0);
  const [profiles, setProfiles] = useState(false);
  const [history, setHistory] = useState(false);
  const [ack, setAck] = useState(false);
  const [historyProfileId, setHistoryProfileId] = useState("");
  const [runs, setRuns] = useState<HhImportRun[]>([]);
  const [extraWarnings, setExtraWarnings] = useState<Warning[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [pendingRun, setPendingRun] = useState<string | null>(null);
  useUnsavedDraft(dirty || busy);
  useEffect(() => { folder.current?.setAttribute("webkitdirectory", ""); }, []);
  useEffect(() => { onDirtyChange(dirty || busy); return () => onDirtyChange(false); }, [dirty, busy, onDirtyChange]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, busy]);
  useEffect(() => () => { stop.current = true; }, []);
  const recent = useQuery({ queryKey: ["hh-imports", ws], queryFn: () => api.listHhImports(ws) });
  const profileList = useInfiniteQuery({
    queryKey: ["opportunity-profiles", ws, false], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.listOpportunityProfiles(ws, pageParam), getNextPageParam: (p) => p.nextCursor ?? undefined, enabled: history
  });

  function change() { setRuns([]); setExtraWarnings([]); setDirty(true); setError(""); }

  function select(list: FileList | null) {
    if (!list) return;
    change(); setPicked([]); setExcluded(0);
    const accepted = Array.from(list).filter((file) => SUPPORTED_KINDS.includes(classifyHhPath(file.webkitRelativePath || file.name)));
    setExcluded(list.length - accepted.length);
    const problem = checkPackageSize(accepted);
    if (problem) { setError(problem); return; }
    // Файлы читаются позже, по одному, при подготовке предпросмотра — здесь только ссылки.
    setPicked(accepted.map((file) => ({ path: file.webkitRelativePath || file.name, size: file.size, text: () => file.text(), bytes: async () => new Uint8Array(await file.arrayBuffer()) })));
  }

  async function preview() {
    setBusy(true); stop.current = false; setError(""); setRuns([]); setExtraWarnings([]);
    const created: HhImportRun[] = []; const warnings: Warning[] = [];
    try {
      setProgress({ done: 0, total: picked.length });
      for await (const part of buildParts(picked, { loadPdfjs: loadBrowserPdfjs }, () => stop.current)) {
        warnings.push(...part.issues.map((i: PackageIssue) => ({ path: i.path, reason: i.reason, code: i.code })));
        setProgress({ done: part.processed, total: picked.length });
        if (!part.files.length) continue;
        try {
          const run = await api.previewHhImport(ws, hhImportPreviewInputSchema.parse({ files: part.files, includeProfiles: profiles, includeHistory: history, historyProfileId: historyProfileId.trim() || null, acknowledgeWorkspaceVisibility: ack }));
          created.push(run); setRuns([...created]);
        } catch (e) {
          // Часть без единой пригодной записи: сервер возвращает 400 с перечнем причин — он попадает в общий отчёт.
          const details = e instanceof ApiError && e.status === 400 ? (e.details as { warnings?: Warning[] } | undefined) : undefined;
          if (!details?.warnings) throw e;
          warnings.push(...details.warnings);
        }
      }
      setExtraWarnings(warnings);
      if (stop.current) setError("Подготовка остановлена. Уже созданные части предпросмотра сохранены; выберите пакет заново, чтобы подготовить остальное.");
      else if (!created.length) setError("Нет поддерживаемых записей для импорта. Причины пропусков указаны ниже.");
      setDirty(false);
      await recent.refetch();
    } catch (e) { setError(`${describeError(e)} ${created.length ? "Созданные части предпросмотра сохранены." : ""}`.trim()); setRuns([...created]); setExtraWarnings(warnings); }
    finally { setBusy(false); setProgress(null); }
  }

  const replaceRun = (next: HhImportRun) => setRuns((current) => current.map((r) => (r.id === next.id ? next : r)));

  async function apply() {
    setBusy(true); stop.current = false; setError("");
    try {
      for (const start of runs) {
        let current = await api.getHhImport(ws, start.id); replaceRun(current);
        while (!stop.current && (current.status === "preview" || current.status === "applying")) {
          current = await api.applyHhImport(ws, current.id, { expectedRevision: current.revision, manifestHash: current.manifestHash }); replaceRun(current);
        }
        if (stop.current) break;
      }
      await Promise.all([recent.refetch(), cache.invalidateQueries({ queryKey: ["opportunities", ws] }), cache.invalidateQueries({ queryKey: ["opportunity-profiles", ws] }), cache.invalidateQueries({ queryKey: ["hh-history", ws] })]);
    } catch (e) { setError(`${describeError(e)} Уже сохранённые порции остаются. Обновите состояние перед продолжением.`); }
    finally { setBusy(false); }
  }

  async function cancel() {
    setBusy(true); setError("");
    try {
      for (const run of runs) if (run.status === "preview" || run.status === "applying") replaceRun(await api.cancelHhImport(ws, run.id, { expectedRevision: run.revision, manifestHash: run.manifestHash }));
      await recent.refetch();
    } catch (e) { setError(describeError(e)); } finally { setBusy(false); }
  }

  async function refresh() {
    setBusy(true); setError("");
    try { for (const run of runs) replaceRun(await api.getHhImport(ws, run.id)); } catch (e) { setError(describeError(e)); } finally { setBusy(false); }
  }

  async function load(id: string, discard = false) {
    if (dirty && !discard) { setPendingRun(id); return; }
    setPendingRun(null); setBusy(true); setError("");
    try { setRuns([await api.getHhImport(ws, id)]); setExtraWarnings([]); setDirty(false); setPicked([]); } catch (e) { setError(describeError(e)); } finally { setBusy(false); }
  }

  const active = runs.some((r) => r.status === "preview" || r.status === "applying");
  const expired = runs.some((r) => (r.status === "preview" || r.status === "applying") && new Date(r.expiresAt) <= new Date());
  const sum = (pick: (r: HhImportRun) => number) => runs.reduce((total, r) => total + pick(r), 0);
  const warnings: Warning[] = [...runs.flatMap((r) => r.preview.warnings), ...extraWarnings];
  const groups = groupWarnings(warnings);
  const allApplied = runs.length > 0 && runs.every((r) => r.status === "applied");
  const allCanceled = runs.length > 0 && runs.every((r) => r.status === "canceled");
  const candidates = [...new Set(runs.flatMap((r) => r.preview.candidateNames))];
  const started = runs.some((r) => r.checkpoint > 0);
  const totalBytes = picked.reduce((total, f) => total + f.size, 0);

  return <div className="space-y-4">
    <ConfirmDialog open={pendingRun !== null} title="Открыть другой импорт?" description="Текущий выбор файлов ещё не сохранён в предпросмотр. Он будет сброшен." confirmLabel="Открыть импорт" danger={false} onCancel={() => setPendingRun(null)} onConfirm={() => { if (pendingRun) void load(pendingRun, true); }} />
    <p className="text-sm text-muted-foreground">
      Импорт в «{workspaceLabel}» использует выбранные файлы. Поддерживаются резюме и письма в MD, TXT, PDF, DOCX и RTF, снимки вакансий и журналы JSON.
      Текст из документов извлекается в этом окне, макросы и скрипты не выполняются. Старый двоичный DOC не читается — сохраните его как DOCX или PDF.
      Сканы без текстового слоя не распознаются (OCR нет). Скрипты и браузерные сессии исключаются до загрузки.
    </p>
    <fieldset disabled={busy} className="min-w-0 space-y-3 rounded-xl border border-border p-4"><legend className="px-1 font-medium">Выбор данных</legend>
      <label className="block text-sm">Папка с материалами HH<input ref={folder} type="file" multiple className="mt-1 block max-w-full text-sm" onChange={(e) => select(e.target.files)} /></label>
      <label className="block text-sm">Или отдельные файлы<input type="file" multiple accept=".json,.md,.txt,.pdf,.docx,.doc,.rtf" className="mt-1 block max-w-full text-sm" onChange={(e) => select(e.target.files)} /></label>
      <p className="text-sm">
        Выбрано поддерживаемых файлов: {picked.length} ({(totalBytes / 1024 / 1024).toFixed(1)} МБ). Исключено / не поддерживается: {excluded}.
        Лимит пакета: {PACKAGE_LIMITS.maxFiles} файлов и {PACKAGE_LIMITS.maxTotalBytes / 1024 / 1024} МБ; большой пакет сам делится на части.
      </p>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={profiles} onChange={(e) => { setProfiles(e.target.checked); change(); }} />Добавить профили и версии материалов (нужно включить расширение «Профили»)</label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={history} onChange={(e) => { setHistory(e.target.checked); change(); }} />Добавить исторические записи откликов</label>
      {history && <div className="space-y-2">
        <label className="block text-sm">Профиль для истории (необязательно)
          <select className="mt-1 block min-h-10 w-full rounded-lg border border-border bg-background px-3" value={historyProfileId} onChange={(e) => { setHistoryProfileId(e.target.value); change(); }}>
            <option value="">Без профиля</option>{profileList.data?.pages.flatMap((p) => p.items).map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
          <span className="text-xs text-muted-foreground">Профиль по имени файла не угадывается. Выберите его только если точно знаете, кому принадлежит журнал.</span>
        </label>
        {profileList.hasNextPage && <Button variant="outline" onClick={() => void profileList.fetchNextPage()}>Ещё профили</Button>}
        {profileList.isError && <p className="text-xs text-muted-foreground">Профили недоступны: {describeError(profileList.error)}. Историю можно сохранить без профиля.</p>}
      </div>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} onChange={(e) => { setAck(e.target.checked); change(); }} />Разрешаю сохранить выбранные материалы в этом пространстве с доступом его участников. Журналы импорта доступны владельцу.</label>
      <Button disabled={!ack || !picked.length || busy} onClick={() => void preview()}>Подготовить предпросмотр</Button>
    </fieldset>
    {progress && <p className="text-sm" role="status" aria-live="polite">Прочитано {progress.done} из {progress.total} файлов{runs.length ? `; частей предпросмотра: ${runs.length}` : ""}.
      <Button className="ml-2" size="sm" variant="outline" onClick={() => { stop.current = true; }}>Остановить</Button></p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {(runs.length > 0 || warnings.length > 0) && <section className="space-y-3 rounded-xl border border-border p-4" aria-label="Предпросмотр импорта">
      <h2 className="font-medium">{allApplied ? "Импорт завершён" : allCanceled ? "Импорт отменён" : runs.length ? "Предпросмотр и сохранение" : "Отчёт о пропусках"}{runs.length > 1 ? ` — частей: ${runs.length}` : ""}</h2>
      {runs.length > 0 && <>
        <p className="text-sm">Вакансий / снимков: {sum((r) => r.preview.opportunities)}; материалов: {sum((r) => r.preview.materials)}; записей истории: {sum((r) => r.preview.history)}.</p>
        {!!candidates.length && <p className="text-sm">Профили: {candidates.join(", ")}</p>}
        <p className="text-xs text-muted-foreground">Применяется сохранённый снимок файлов. После изменения файлов создайте новый предпросмотр. Срок: {new Date(Math.min(...runs.map((r) => new Date(r.expiresAt).getTime()))).toLocaleString("ru-RU")}.</p>
        <details><summary className="text-sm">Примеры записей</summary><ul className="space-y-1 py-2 text-xs">{runs.flatMap((r) => r.preview.samples).slice(0, 20).map((s, i) => <li key={i} className="break-words">{s.title} · {s.sourcePath}</li>)}</ul></details>
      </>}
      {!!groups.length && <div className="space-y-2">
        <p className="text-sm font-medium">Пропуски и замечания: {warnings.length}. Эти файлы не будут импортированы.</p>
        {groups.map((g) => <details key={g.code} open={g.items.length <= 10}><summary className="text-sm">{g.label} ({g.items.length})</summary>
          <ul className="space-y-1 py-2 text-xs">{g.items.map((w, i) => <li key={i} className="break-words">{w.path}: {w.reason}</li>)}</ul></details>)}
      </div>}
      {runs.length > 0 && <>
        <p className="text-sm" aria-live="polite">
          Обработано {sum((r) => r.checkpoint)} из {sum((r) => r.total)}. Новых вакансий: {sum((r) => r.report.opportunitiesCreated)}; существующих: {sum((r) => r.report.opportunitiesExisting)}; снимков: {sum((r) => r.report.capturesCreated)};
          профилей: {sum((r) => r.report.profilesCreated)}; новых версий: {sum((r) => r.report.materialsCreated)}; исторических записей: {sum((r) => r.report.historyCreated)}; возможных дублей: {sum((r) => r.report.possibleDuplicates)}.
        </p>
        {runs.length > 1 && <ul className="space-y-1 text-xs">{runs.map((r, i) => <li key={r.id}>Часть {i + 1}: {STATUS_LABEL[r.status]} · {r.checkpoint}/{r.total}</li>)}</ul>}
        <p className="text-sm text-muted-foreground">Импорт не отправляет отклики. Историческое «verified» — утверждение старого журнала; факты профиля не подтверждаются автоматически. Отмена останавливает следующие порции, уже сохранённые данные остаются.</p>
        <div className="flex flex-wrap gap-2">
          {active && <>
            <Button disabled={busy || expired} onClick={() => void apply()}>{started ? "Продолжить импорт" : runs.length > 1 ? "Сохранить все части" : "Сохранить выбранные данные"}</Button>
            <Button variant="outline" disabled={busy} onClick={() => void cancel()}>Отменить оставшуюся часть</Button>
          </>}
          {busy && !progress && <Button variant="outline" onClick={() => { stop.current = true; }}>Остановить после текущей порции</Button>}
          <Button variant="outline" disabled={busy} onClick={() => void refresh()}>Обновить состояние</Button>
        </div>
      </>}
    </section>}
    <HistoryLog workspaceId={ws} />
    <section className="space-y-2"><h2 className="font-medium">Последние импорты</h2>
      {recent.isError && <p role="alert">{describeError(recent.error)}</p>}
      {recent.data?.map((r) => <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void load(r.id)}>{new Date(r.createdAt).toLocaleString("ru-RU")}</Button>
        <span>{STATUS_LABEL[r.status]} · {r.checkpoint}/{r.total}</span>
      </div>)}
    </section>
  </div>;
}
