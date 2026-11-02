"use client";

import { ApiError, createModuleClient, workspaceModuleBase } from "@orion/core";
import { useCore } from "@orion/core-react";
import { developmentPreviewSchema, developmentConsentSchema, developmentResultSchema,
  type DevelopmentPreviewResponse, type DevelopmentImportResult } from "@orion/shared-types";
import { Button } from "@orion/ui";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { openProject, openTask, useObjectOpeningAvailable } from "../../lib/panel-bus";

export function DevelopmentReview({ workspaceId, name, onImportingChange }: { workspaceId: string; name: string; onImportingChange: (busy: boolean) => void }): React.ReactElement {
  const { api } = useCore();
  const openingAvailable = useObjectOpeningAvailable();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<DevelopmentPreviewResponse | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<"preview" | "import" | null>("preview");
  const [error, setError] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [result, setResult] = useState<DevelopmentImportResult | null>(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  const client = () => createModuleClient(api, workspaceModuleBase(workspaceId, "development-import"));

  useEffect(() => { onImportingChange(busy === "import"); }, [busy, onImportingChange]);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    const initialClient = createModuleClient(api, workspaceModuleBase(workspaceId, "development-import"));
    withDeadline(initialClient.get("/preview", developmentPreviewSchema)).then(value => {
      if (!disposed) setPreview(value);
    }).catch(reason => {
      if (!disposed) setError(loadError(reason));
    }).finally(() => { if (!disposed) setBusy(null); });
    return () => { disposed = true; mounted.current = false; };
  }, [api, workspaceId]);

  async function refresh() {
    if (pending.current) return;
    pending.current = true;
    setBusy("preview"); setError("");
    try {
      const value = await withDeadline(client().get("/preview", developmentPreviewSchema));
      if (!mounted.current) return;
      // Decisions belong to the exact reviewed snapshot, never a refreshed one.
      setPreview(value); setChoices({}); setAcknowledged(false); setNeedsRefresh(false); setResult(null);
    } catch (reason) { if (mounted.current) setError(loadError(reason)); }
    finally { pending.current = false; if (mounted.current) setBusy(null); }
  }

  async function apply() {
    if (!preview || pending.current || busy || needsRefresh || !acknowledged) return;
    pending.current = true;
    setBusy("import"); setError("");
    let applying = false;
    try {
      const body = { workspaceConfirmed: true, previewDigest: preview.previewDigest, choices };
      const consent = await withDeadline(client().post("/consent", body, developmentConsentSchema));
      if (!mounted.current) return;
      applying = true;
      const value = await withDeadline(client().post("/apply", { ...body, token: consent.token }, developmentResultSchema));
      if (!mounted.current) return;
      setResult(value); setNeedsRefresh(true);
      await Promise.all(["projects", "tasks"].map(key => queryClient.invalidateQueries({ queryKey: [key, workspaceId] })));
    } catch (reason) {
      if (!mounted.current) return;
      const stale = reason instanceof ApiError && reason.status === 409;
      setNeedsRefresh(applying || stale);
      setError(stale ? "План изменился, подтверждение устарело или обнаружен конфликт зависимостей. Обновите план и проверьте его снова." :
        reason instanceof ApiError && reason.status === 403 ? loadError(reason) :
        applying ? "Ответ об импорте не получен. Обновите план, чтобы проверить сохранённые данные перед повторной попыткой." : loadError(reason));
    } finally { pending.current = false; if (mounted.current) setBusy(null); }
  }

  const actions = preview?.plan.actions ?? [];
  const reviews = actions.filter(row => row.action === "review_possible_match");
  const creates = actions.filter(row => row.action === "propose_create");
  const reviewed = reviews.every(row => choices[`${row.kind}:${row.externalId}`] === row.candidateId);
  return <div className="min-w-0 space-y-5 text-base sm:text-sm">
    <div>
      <h2 className="font-semibold break-words">Пространство: {name}</h2>
      <details className="mt-1 text-xs text-muted-foreground"><summary className="cursor-pointer py-2">Технические сведения</summary><p className="break-all">{workspaceId}</p></details>
      <p className="mt-2 text-muted-foreground">Каталог добавляет проекты, задачи и зависимости. Существующие совпадения связываются только после вашего выбора. Описания существующих объектов сохраняются.</p>
    </div>
    {!openingAvailable && <p className="text-sm text-muted-foreground">Для открытия проектов и задач используйте основное рабочее окно Orion. Проверка и импорт доступны здесь.</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {busy && <p role="status">{busy === "preview" ? "Проверяем каталог и данные пространства…" : "Проверяем подтверждение и сохраняем каталог…"}</p>}
    {result ? <section aria-label="Результат импорта" className="space-y-3">
      <h3 className="font-semibold" tabIndex={-1}>Каталог сохранён в пространстве «{name}»</h3>
      <p role="status">Создано проектов: {result.projects.filter(row => row.outcome === "created").length}; задач: {result.tasks.filter(row => row.outcome === "created").length}; зависимостей: {result.dependencies.created}.</p>
      <ul className="space-y-1">{result.projects.map(row => <li key={row.externalId}>
        <Button type="button" variant="ghost" size="sm" disabled={!openingAvailable} onClick={() => openProject(row.entityId)}>
          Открыть {actions.find(action => action.kind === "project" && action.externalId === row.externalId)?.title ?? row.externalId}
        </Button>
      </li>)}</ul>
      <details><summary className="cursor-pointer py-2">Импортированные задачи ({result.tasks.length})</summary>
        <ul>{result.tasks.map(row => <li key={row.externalId}><Button type="button" variant="ghost" size="sm" disabled={!openingAvailable} onClick={() => openTask(row.entityId)}>Открыть {row.externalId}</Button></li>)}</ul>
      </details>
    </section> : preview ? <>
      <p>Будет создано: {creates.filter(row => row.kind === "project").length} проектов, {creates.filter(row => row.kind === "task").length} задач. Требуют проверки: {reviews.length}. Уже связаны: {actions.filter(row => row.action === "already_mapped").length}.</p>
      <section aria-label="План импорта" className="divide-y divide-border">
        {actions.map(row => {
          const key = `${row.kind}:${row.externalId}`;
          const item = preview.catalog.workItems.find(item => item.id === row.externalId);
          return <div key={key} className="min-w-0 py-3">
            <div className="flex flex-wrap justify-between gap-2">
              <p className="min-w-0 break-words font-medium">{row.title}</p>
              <span className="text-muted-foreground">{row.action === "propose_create" ? "Создать" : row.action === "already_mapped" ? "Уже связано" : "Проверьте совпадение"}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{row.externalId}{item?.phase ? ` · ${item.phase}` : ""}</p>
            {row.projectExternalId && <p className="mt-1 text-muted-foreground">Проект: {actions.find(project => project.kind === "project" && project.externalId === row.projectExternalId)?.title}</p>}
            {item?.acceptance?.length ? <details className="mt-1"><summary className="cursor-pointer py-2">Критерии приёмки</summary><ul className="list-disc space-y-1 pl-5">{item.acceptance.map(value => <li key={value}>{value}</li>)}</ul></details> : null}
            {row.dependsOn?.length ? <p className="mt-1 break-words text-muted-foreground">Зависит от: {row.dependsOn.join(", ")}</p> : null}
            {row.action === "review_possible_match" && <label className="mt-2 flex min-h-12 cursor-pointer items-center gap-3 break-all">
              <input type="checkbox" name={key} checked={choices[key] === row.candidateId} disabled={Boolean(busy) || needsRefresh}
                onChange={event => setChoices(previous => { const next = { ...previous }; if (event.target.checked) next[key] = row.candidateId!; else delete next[key]; return next; })} />
              Связать с существующим {row.kind === "project" ? "проектом" : "задачей"}: {row.candidateId}
            </label>}
            {row.action === "review_possible_match" && row.candidateId && <Button type="button" variant="ghost" size="sm" disabled={!openingAvailable} onClick={() => row.kind === "project" ? openProject(row.candidateId!) : openTask(row.candidateId!)}>Открыть совпадение: {row.title}</Button>}
          </div>;
        })}
      </section>
      <label className="flex min-h-12 cursor-pointer items-center gap-3">
        <input type="checkbox" name="workspace-confirmed" checked={acknowledged} disabled={Boolean(busy) || needsRefresh} onChange={event => setAcknowledged(event.target.checked)} />
        Импортировать этот план в пространство «{name}»
      </label>
      {(!acknowledged || !reviewed) && <p className="text-muted-foreground">Для импорта проверьте все совпадения и подтвердите пространство.</p>}
    </> : null}
    <div className="flex flex-wrap gap-3">
      {preview && !result && <Button type="button" disabled={Boolean(busy) || !reviewed || !acknowledged || needsRefresh} onClick={() => void apply()}>Импортировать каталог</Button>}
      <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => void refresh()}>Обновить план</Button>
    </div>
  </div>;
}

export function loadError(reason: unknown): string {
  if (reason instanceof ApiError && reason.status === 403) return "Доступ изменился. Импорт доступен владельцу и руководителю пространства.";
  if (reason instanceof ApiError && reason.status === 409) {
    if (/ambiguous/i.test(reason.message)) return "Найдено несколько проектов или задач с одинаковыми названиями. Уточните названия в пространстве и обновите план; автоматический выбор заблокирован.";
    if (/mapping|binding/i.test(reason.message)) return "Сопоставления каталога конфликтуют с данными пространства. Требуется проверить сопоставления перед импортом.";
    return "План недоступен: проверьте, что модули ORION DEV, Проекты и Задачи включены, а каталог установлен на сервере. Затем обновите план.";
  }
  return "Не удалось получить план или подтверждение. Проверьте соединение и повторите попытку; ваши решения сохранены.";
}

/** A stalled transport must leave a recovery path. A timed-out write may still
 * commit, so its only recovery is a fresh preview, never an automatic retry. */
export async function withDeadline<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Development request timed out")), 30_000);
    })]);
  } finally { clearTimeout(timer); }
}
