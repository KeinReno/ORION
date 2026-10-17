"use client";

import { useProject } from "@orion/core-react";
import { Button, IconButton } from "@orion/ui";
import { X } from "lucide-react";
import type { ProjectView } from "./workspace-context";

/** Read-only context for the active project. Editing remains in its existing domain views. */
export function ProjectContextInspector({ workspaceId, workspaceName, projectId, views, onOpen, onClose }: {
  workspaceId: string; workspaceName: string; projectId: string; views: ProjectView[];
  onOpen: (panelId: string, title: string) => void; onClose: () => void;
}): React.ReactElement {
  const project = useProject(workspaceId, projectId);
  const data = project.data;
  const statuses = { active: "Активен", on_hold: "На паузе", completed: "Завершён" };
  return <aside aria-label="Свойства проекта" className="flex h-full min-h-0 flex-col bg-background text-foreground">
    <div className="flex min-h-14 items-center justify-between border-b border-border px-4"><h2 className="text-label font-medium">Свойства проекта</h2><IconButton label="Закрыть свойства проекта" onClick={onClose}><X className="h-4 w-4" /></IconButton></div>
    <div className="orion-scroll min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
      <p className="break-words text-label text-subtle-foreground">{workspaceName}</p>
      {project.isPending ? <p role="status">Загрузка…</p> : project.isError || !data ? <div role="alert"><p className="text-label text-muted-foreground">Проект недоступен или не удалось его загрузить.</p><Button variant="ghost" onClick={() => void project.refetch()}>Повторить</Button></div> : <>
        <h3 className="break-words text-title">{data.name}</h3>
        {data.description ? <p className="whitespace-pre-wrap break-words text-body text-muted-foreground">{data.description}</p> : null}
        <dl className="space-y-3 text-label">
          <div className="flex justify-between gap-4"><dt className="text-subtle-foreground">Статус</dt><dd>{statuses[data.status]}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-subtle-foreground">Задачи</dt><dd>{data.counts.closed} / {data.counts.tasks} закрыто</dd></div>
          {data.dueAt ? <div className="flex justify-between gap-4"><dt className="text-subtle-foreground">Срок</dt><dd>{new Date(data.dueAt).toLocaleDateString("ru-RU")}</dd></div> : null}
        </dl>
        {data.contextNote ? <section><h4 className="mb-2 text-micro uppercase text-subtle-foreground">Где остановились</h4><p className="whitespace-pre-wrap break-words text-body text-muted-foreground">{data.contextNote}</p></section> : null}
        <section aria-label="Представления проекта"><h4 className="mb-2 text-micro uppercase text-subtle-foreground">Представления</h4>{views.map(view => <button key={view.id} type="button" className="block min-h-11 sm:min-h-9 w-full rounded-md px-2 text-left text-label text-muted-foreground hover:bg-card-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => onOpen(`${view.id}:${projectId}`, `${data.name} · ${view.label}`)}>{view.label}</button>)}</section>
      </>}
    </div>
  </aside>;
}
