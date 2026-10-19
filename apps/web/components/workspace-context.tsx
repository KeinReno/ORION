"use client";

import { useProjects } from "@orion/core-react";
import { Button, DropdownMenu, IconButton, Input, cx, useToast, type SidebarFolderView, type SidebarLinkItem } from "@orion/ui";
import { ChevronRight, FolderKanban, MoreHorizontal, Pin, PinOff, Search, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { parseProjectPins, projectPinsKey } from "../lib/shell-context";
import { NotesContext, TasksContext } from "./context-sections";

export type ProjectOpenMode = "open" | "beside" | "window";
export type ProjectView = { id: string; label: string };

/** Real workspace data through public hooks; never imports a domain panel's internals. */
export function WorkspaceContext({ userId, workspaceId, switcher, projectsEnabled, activeProjectId, activeKind, views, folders, links, onOpen, onClose }: {
  userId: string; workspaceId: string; switcher: ReactNode; projectsEnabled: boolean;
  /** Sidebar item of the open panel (`notes`, `tasks`, …): what is inside that module is shown above the projects, which stay in place. */
  activeKind?: string;
  activeProjectId?: string; views: ProjectView[]; folders: SidebarFolderView[]; links: SidebarLinkItem[];
  onOpen: (panelId: string, title: string, mode: ProjectOpenMode) => void; onClose: () => void;
}): React.ReactElement {
  const projects = useProjects(projectsEnabled ? workspaceId : undefined);
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<string[]>([]);
  const [pins, setPins] = useState<string[]>([]);
  const key = projectPinsKey(userId, workspaceId);
  useEffect(() => {
    const read = (): void => { try { setPins(parseProjectPins(localStorage.getItem(key))); } catch { setPins([]); } };
    read();
    const sync = (event: StorageEvent): void => { if (event.key === key) read(); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);
  function togglePin(id: string): void {
    const next = pins.includes(id) ? pins.filter(pin => pin !== id) : [...pins, id].slice(-100);
    try { localStorage.setItem(key, JSON.stringify(next)); setPins(next); }
    catch { toast({ title: "Не удалось сохранить закрепление", description: "Проверьте доступ к локальному хранилищу.", tone: "danger" }); }
  }
  // Unavailable/deleted projects never get rendered from stored pin IDs. Pins are not pruned on a failed fetch.
  const available = projects.data ?? [];
  const shown = available.filter(project => project.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const pinned = available.filter(project => pins.includes(project.id));
  const rowClass = "flex min-h-11 sm:min-h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-base sm:text-label text-muted-foreground hover:bg-card-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  const moduleSection = activeKind === "notes" ? <NotesContext workspaceId={workspaceId} /> : activeKind === "tasks" ? <TasksContext workspaceId={workspaceId} /> : null;
  return <aside id="orion-workspace-context" aria-label="Контекст пространства" className="flex h-full min-h-0 w-full flex-col bg-background text-foreground">
    <div className="flex min-h-16 items-center gap-1 border-b border-border px-3">
      {switcher}
      <IconButton label="Скрыть контекст пространства" onClick={onClose}><X className="h-4 w-4" /></IconButton>
    </div>
    <div className="orion-scroll min-h-0 min-w-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto p-3">
      {moduleSection}
      {projectsEnabled ? <>
        <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-3 h-4 w-4 text-subtle-foreground" aria-hidden />
          <Input aria-label="Найти проект в пространстве" placeholder="Найти проект" value={query} onChange={event => setQuery(event.target.value)} className="pl-9" /></div>
        <section aria-label="Закреплённые проекты">
          <h2 className="mb-2 px-2 text-micro uppercase text-subtle-foreground">Закреплено</h2>
          {pinned.length === 0 ? <p className="px-2 text-label text-subtle-foreground">Закрепляйте проекты через меню рядом с названием.</p> : pinned.map(project => <button key={project.id} type="button" className={rowClass}
            title={project.name} aria-current={activeProjectId === project.id ? "page" : undefined} onClick={() => onOpen(`project:${project.id}`, project.name, "open")}>
            <Pin className="h-3.5 w-3.5 shrink-0 text-accent-text" aria-hidden /><span className="truncate">{project.name}</span></button>)}
        </section>
        <section aria-label="Проекты пространства">
          <h2 className="mb-2 flex items-center justify-between px-2 text-micro uppercase text-subtle-foreground"><span>Проекты</span>{projects.isSuccess ? <span>{available.length}</span> : null}</h2>
          {projects.isPending ? <p role="status" className="px-2 text-label text-subtle-foreground">Загрузка проектов…</p> : projects.isError ? <div role="alert" className="px-2 text-label text-subtle-foreground">Не удалось загрузить проекты.<Button variant="ghost" onClick={() => void projects.refetch()}>Повторить</Button></div> : shown.length === 0 ? <p className="px-2 text-label text-subtle-foreground">{query ? "Проекты не найдены." : "Проектов пока нет. Создайте первый в разделе «Проекты»."}</p> : shown.map(project => <div key={project.id} className="mb-1">
            <div className="flex items-center rounded-md">
              <button type="button" className="flex h-11 sm:h-9 w-6 shrink-0 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={`Виды проекта ${project.name}`} aria-expanded={expandedProjects.includes(project.id)} onClick={() => setExpandedProjects(ids => ids.includes(project.id) ? ids.filter(id => id !== project.id) : [...ids, project.id])}><ChevronRight className={cx("h-3.5 w-3.5", expandedProjects.includes(project.id) && "rotate-90")} /></button>
              <button type="button" className={cx(rowClass, "flex-1", activeProjectId === project.id && "bg-card-hover text-foreground")}
                title={project.name} aria-current={activeProjectId === project.id ? "page" : undefined} onClick={event => { event.preventDefault(); onOpen(`project:${project.id}`, project.name, "open"); }}>
                <FolderKanban className="h-4 w-4 shrink-0 text-subtle-foreground" aria-hidden /><span className="min-w-0 flex-1 truncate">{project.name}</span>
              </button>
              <DropdownMenu align="end" trigger={({ toggle }) => <button type="button" onClick={event => { event.preventDefault(); toggle(); }} aria-label={`Действия проекта ${project.name}`} className="flex h-11 sm:h-9 w-8 shrink-0 items-center justify-center rounded text-subtle-foreground hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><MoreHorizontal className="h-4 w-4" /></button>}
                items={[
                  { label: pins.includes(project.id) ? "Открепить проект" : "Закрепить проект", icon: pins.includes(project.id) ? PinOff : Pin, onSelect: () => togglePin(project.id) },
                  { label: "Открыть рядом", onSelect: () => onOpen(`project:${project.id}`, project.name, "beside") },
                  { label: "Открыть в отдельном окне", onSelect: () => onOpen(`project:${project.id}`, project.name, "window") }
                ]} />
            </div>
            {expandedProjects.includes(project.id) ? <div className="ml-5 border-l border-border pl-2">{views.map(view => <button key={view.id} type="button" className={rowClass} onClick={() => onOpen(`${view.id}:${project.id}`, `${project.name} · ${view.label}`, "open")}>{view.label}</button>)}</div> : null}
          </div>)}
        </section>
      </> : <p className="px-2 text-label text-subtle-foreground">Проекты выключены или скрыты. Открывайте доступные разделы на панели модулей.</p>}
      {folders.length > 0 ? <section aria-label="Ваши папки разделов"><h2 className="mb-2 px-2 text-micro uppercase text-subtle-foreground">Ваши разделы</h2>{folders.map(folder => <details key={folder.id} className="mb-2"><summary className="cursor-pointer px-2 py-2 text-label text-muted-foreground">{folder.name}</summary>{folder.linkIds.map(id => links.find(link => link.id === id)).filter((link): link is SidebarLinkItem => Boolean(link)).map(link => <button key={link.id} type="button" className={rowClass} onClick={link.onClick}>{link.label}</button>)}</details>)}</section> : null}
    </div>
    <p className="border-t border-border px-5 py-3 text-micro text-subtle-foreground">Закрепления — на этом устройстве</p>
  </aside>;
}
