"use client";

import { createModuleClient, workspaceModuleBase } from "@orion/core";
import { useCore, useProjects, useTasks } from "@orion/core-react";
import { developmentPreviewSchema } from "@orion/shared-types";
import { Badge, Button, EmptyState, PanelBody, PanelHeader, PanelShell } from "@orion/ui";
import { ArrowRight, Code2, Folder, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useActiveWorkspace } from "../../lib/use-active-workspace";
import { useDevelopmentNavigation } from "./use-development-navigation";
import { DevelopmentReview, loadError, withDeadline } from "./DevelopmentImportReview";
import { buildOverview, phases, projectDescription, statusLabels } from "./presentation";
import styles from "./orion-dev.module.css";

const ArchitectWorkbench = dynamic(() => import("./ArchitectWorkbench").then(module => module.ArchitectWorkbench), { ssr: false, loading: () => <p role="status">Загружаем рабочую поверхность Architect…</p> });

export function OrionDevPanel(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  return <PanelShell>
    <PanelHeader icon={Code2} title="ORION DEV" subtitle={workspace ? `Разработка Orion · ${workspace.name}` : "Управление разработкой Orion"} />
    <PanelBody measure="wide">
      {!workspace ? <EmptyState icon={Code2} title="Выберите пространство" description="Откройте пространство, в котором хотите вести разработку." /> :
        workspace.role !== "owner" && workspace.role !== "lead" ? <p role="status">Обзор каталога доступен владельцу и руководителю пространства.</p> :
          <DevelopmentWorkspace key={workspace.id} workspaceId={workspace.id} name={workspace.name} />}
    </PanelBody>
  </PanelShell>;
}

function DevelopmentWorkspace({ workspaceId, name }: { workspaceId: string; name: string }): React.ReactElement {
  const { api } = useCore();
  const { openProject, openTask } = useDevelopmentNavigation(workspaceId);
  const [section, setSection] = useState<"overview" | "import" | "architect">("overview");
  const [visitedImport, setVisitedImport] = useState(false);
  const [visitedArchitect, setVisitedArchitect] = useState(false);
  const [importing, setImporting] = useState(false);
  const [phase, setPhase] = useState("foundation");
  const [filter, setFilter] = useState("all");
  const preview = useQuery({
    queryKey: ["orion-dev-overview", workspaceId], retry: false,
    queryFn: () => withDeadline(createModuleClient(api, workspaceModuleBase(workspaceId, "development-import")).get("/preview", developmentPreviewSchema))
  });
  const projects = useProjects(workspaceId);
  const archive = useProjects(workspaceId, true);
  const tasks = useTasks(workspaceId);
  const openImport = () => { setVisitedImport(true); setSection("import"); };
  const refresh = () => { void preview.refetch(); void projects.refetch(); void archive.refetch(); void tasks.refetch(); };
  const loading = preview.isPending || projects.isPending || archive.isPending || tasks.isPending;
  const failed = preview.isError || projects.isError || archive.isError || tasks.isError;
  const overview = preview.data && !loading && !failed ? buildOverview(preview.data, [...(projects.data ?? []), ...(archive.data ?? [])], tasks.data ?? []) : null;
  const liveTasks = overview?.tasks.filter(row => row.entity) ?? [];
  const done = liveTasks.filter(row => row.entity?.status === "done").length;
  const working = liveTasks.filter(row => row.entity?.status === "in_progress").length;
  const blocked = liveTasks.filter(row => row.entity?.blocked && row.entity.status !== "done" && row.entity.status !== "canceled").length;
  const selectedPhase = phases.find(item => item.id === phase);
  const phaseTasks = overview?.tasks.filter(row => phase === "all" || row.phase === phase) ?? [];
  const visibleTasks = phaseTasks.filter(row => filter === "all" || (filter === "blocked" ? row.entity?.blocked && row.entity.status !== "done" && row.entity.status !== "canceled" : row.entity?.status === filter));
  const phaseProjects = overview?.projects.filter(row => phase === "all" || row.phase === phase) ?? [];
  // Include projects hosting tasks from the selected phase (e.g. modules in features).
  const projectIds = new Set(phaseTasks.map(row => row.projectExternalId));
  const visibleProjects = overview?.projects.filter(row => phaseProjects.includes(row) || projectIds.has(row.externalId)) ?? [];

  return <div className={styles.workspace}>
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <nav aria-label="Разделы ORION DEV" className="flex flex-wrap gap-2">
        <Button variant={section === "overview" ? "primary" : "ghost"} size="sm" aria-pressed={section === "overview"} disabled={importing} onClick={() => { setSection("overview"); refresh(); }}>Обзор разработки</Button>
        <Button variant={section === "import" ? "primary" : "ghost"} size="sm" aria-pressed={section === "import"} disabled={importing} onClick={openImport}>Импорт каталога</Button>
        <Button variant={section === "architect" ? "primary" : "ghost"} size="sm" aria-pressed={section === "architect"} disabled={importing} onClick={() => { setVisitedArchitect(true); setSection("architect"); }}>Архитектура и Git</Button>
      </nav>
      {section === "overview" && <Button variant="ghost" size="sm" disabled={preview.isFetching || projects.isFetching || archive.isFetching || tasks.isFetching} onClick={refresh}><RefreshCw size={14} aria-hidden />Обновить обзор</Button>}
    </div>
    {visitedImport && <div hidden={section !== "import"}><DevelopmentReview workspaceId={workspaceId} name={name} onImportingChange={setImporting} /></div>}
    {visitedArchitect && <div hidden={section !== "architect"}><ArchitectWorkbench workspaceId={workspaceId} /></div>}
    <div hidden={section !== "overview"}>
      {loading && <p role="status">Загружаем направления и задачи…</p>}
      {failed && <div role="alert" className="rounded-xl border border-destructive/30 p-4"><p>{preview.isError ? loadError(preview.error) : "Не удалось загрузить проекты или задачи. Обновите обзор, чтобы увидеть актуальное состояние."}</p></div>}
      {overview && (liveTasks.length === 0 && overview.projects.every(row => !row.entity) && !overview.missing ?
        <EmptyState icon={Code2} title="Место для разработки Orion" description="Соберите направления, задачи и зависимости в этом пространстве. Перед добавлением вы проверите план и существующие совпадения." action={<Button onClick={openImport}>Подготовить пространство</Button>} /> : <>
          <section aria-label="Состояние разработки" className="mb-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Рабочее пространство разработки</p><h2 className="text-2xl font-semibold tracking-tight">Разработка Orion</h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Выберите направление и откройте задачу. Статусы берутся из задач пространства; выполнение и приёмка остаются отдельными шагами.</p></div>
              <span className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">{overview.projects.filter(row => row.entity).length} направлений · {liveTasks.length} задач</span>
            </div>
            <dl className={styles.stats}>
              {[[working, "В работе"], [liveTasks.filter(row => row.entity?.status === "todo" || row.entity?.status === "backlog").length, "В планах"], [blocked, "Ожидают зависимостей"], [done, "Завершены"]].map(([count, label]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{count}</dd></div>)}
            </dl>
          </section>
          {(overview.unmapped > 0 || overview.missing > 0) && <p role="status" className="mb-5 rounded-lg border border-border bg-muted/30 p-3 text-sm">{overview.unmapped > 0 && `В каталоге есть несвязанные объекты: ${overview.unmapped}. Проверьте раздел «Импорт каталога». `}{overview.missing > 0 && `Связанные объекты недоступны: ${overview.missing}. Обновите обзор и проверьте доступ.`}</p>}
          <section aria-label="Этапы разработки">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Этапы разработки</h3><span className="text-xs text-muted-foreground">Сначала — надёжность платформы</span></div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Выбрать этап">
              {[...phases, { id: "all", title: "Все этапы" }].map(item => <Button key={item.id} size="sm" variant={phase === item.id ? "primary" : "outline"} aria-pressed={phase === item.id} onClick={() => { setPhase(item.id); setFilter("all"); }}>{item.title}</Button>)}
            </div>
            <p className="mb-6 mt-3 text-sm text-muted-foreground">{selectedPhase?.description ?? "Все направления и задачи каталога разработки."}</p>
          </section>
          <div className={styles.columns}>
            <section aria-label="Направления" className="min-w-0">
              <h3 className="mb-3 font-semibold">Направления <span className="ml-1 text-sm font-normal text-muted-foreground">{visibleProjects.length}</span></h3>
              <div className="overflow-hidden rounded-xl border border-border divide-y divide-border">{visibleProjects.map(row => <button type="button" key={row.externalId} disabled={!row.entity} onClick={() => row.entity && openProject(row.entity.id)} className="group flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/40 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Folder size={17} aria-hidden /></span>
                <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{row.label}</span><span className="mt-1 block break-words text-xs leading-relaxed text-muted-foreground">{row.entity?.archivedAt ? "В архиве" : !row.entity ? row.action === "already_mapped" ? "Проект недоступен" : "Не добавлено в пространство" : projectDescription(row.externalId)}</span></span><ArrowRight size={15} className="shrink-0 text-muted-foreground" aria-hidden />
              </button>)}</div>
              {visibleProjects.length === 0 && <p className="text-sm text-muted-foreground">В этом этапе нет направлений.</p>}
            </section>
            <section aria-label="Задачи этапа" className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Задачи этапа <span className="ml-1 text-sm font-normal text-muted-foreground">{phaseTasks.length}</span></h3>
                <label className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-xs text-muted-foreground">Показать<select name="development-task-status" className="min-h-9 max-w-full rounded-md border border-border bg-panel px-2 text-sm text-foreground focus-visible:outline-accent" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Все задачи</option><option value="todo">К выполнению</option><option value="in_progress">В работе</option><option value="blocked">Ожидают зависимостей</option><option value="done">Завершённые</option><option value="canceled">Отменённые</option></select></label>
              </div>
              <div className="divide-y divide-border border-y border-border">{visibleTasks.map(row => <button type="button" key={row.externalId} disabled={!row.entity} onClick={() => row.entity && openTask(row.entity.id)} className="block w-full py-4 text-left transition-colors hover:bg-muted/30 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2">
                <span className="mb-2 flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-muted-foreground">{row.externalId}</span><Badge tone={row.entity?.status === "in_progress" ? "accent" : row.entity?.status === "done" ? "success" : "neutral"}>{row.entity ? statusLabels[row.entity.status] : row.action === "already_mapped" ? "Недоступна" : "Не добавлена"}</Badge>{row.entity?.blocked && row.entity.status !== "done" && row.entity.status !== "canceled" && <Badge tone="warning">Ожидает зависимостей</Badge>}</span>
                <span className="flex items-center justify-between gap-3"><span className="min-w-0 break-words text-sm font-medium leading-relaxed">{row.label}</span><ArrowRight size={15} className="shrink-0 text-muted-foreground" aria-hidden /></span>
                <span className="mt-2 block text-xs text-muted-foreground">{overview.projects.find(project => project.externalId === row.projectExternalId)?.label ?? "Разработка"}{row.entity?.dependencyIds.length ? ` · Зависимостей: ${row.entity.dependencyIds.length}` : ""}</span>
              </button>)}</div>
              {visibleTasks.length === 0 && <p role="status" className="py-8 text-sm text-muted-foreground">Нет задач с выбранным статусом. Выберите другой фильтр.</p>}
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Откройте задачу, чтобы прочитать критерии, изменить статус и добавить результаты проверки.</p>
            </section>
          </div>
        </>)}
    </div>
  </div>;
}
