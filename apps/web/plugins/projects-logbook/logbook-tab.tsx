"use client";

import { useCreateProjectLogEntry, useCreateProjectRelation, useDeleteProjectLogEntry, useDeleteProjectRelation, useProjectLogEntries, useProjectRelations, useProjects, useTasks } from "@orion/core-react";
import { PROJECT_LOG_KIND_LABEL, PROJECT_RELATION_LABEL, type ProjectLogKind, type ProjectRelation, type ProjectRelationType } from "@orion/shared-types";
import { Badge, Button, EmptyState, Input, PanelSection, Select, Skeleton, Textarea, cx, useToast } from "@orion/ui";
import { BookOpenText, Link2, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type DragEvent, type FormEvent } from "react";
import type { ProjectTabSlotProps } from "../../lib/extensions/contracts";
import { describeAuthError, openProjectTask, useEnabledModules } from "../../lib/extensions/host-api";

const TASK_MIME = "application/x-orion-task";
const KINDS: ProjectLogKind[] = ["observation", "decision", "change"];
const RELATIONS: ProjectRelationType[] = ["continues", "replaces", "based_on", "depends_on", "related"];

export function ProjectLogbookTab({ workspaceId, projectId }: ProjectTabSlotProps): React.ReactElement {
  const { data: entries, isLoading, isError, refetch } = useProjectLogEntries(workspaceId, projectId);
  const { data: relations, isLoading: relationsLoading, isError: relationsError } = useProjectRelations(workspaceId, projectId);
  const { data: projects = [] } = useProjects(workspaceId);
  const { isEnabled } = useEnabledModules();
  const tasksOn = isEnabled("tasks");
  const { data: tasks = [] } = useTasks(tasksOn ? workspaceId : undefined);
  const createEntry = useCreateProjectLogEntry(workspaceId, projectId);
  const removeEntry = useDeleteProjectLogEntry(workspaceId, projectId);
  const createRelation = useCreateProjectRelation(workspaceId, projectId);
  const removeRelation = useDeleteProjectRelation(workspaceId, projectId);
  const { toast } = useToast();
  const [kind, setKind] = useState<ProjectLogKind>("observation");
  const [text, setText] = useState("");
  const [rationale, setRationale] = useState("");
  const [taskComments, setTaskComments] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const [relationType, setRelationType] = useState<ProjectRelationType>("continues");
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);

  const linkedIds = new Set(Object.keys(taskComments));
  const availableTasks = useMemo(() => {
    const linked = new Set(Object.keys(taskComments));
    return tasks.filter((task) => !linked.has(task.id));
  }, [tasks, taskComments]);
  const otherProjects = projects.filter((project) => project.id !== projectId);

  function addTask(taskId: string): void {
    if (!tasksOn || !tasks.some((task) => task.id === taskId) || linkedIds.has(taskId)) return;
    setTaskComments((current) => ({ ...current, [taskId]: "" }));
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragOver(false);
    const id = event.dataTransfer.getData(TASK_MIME) || event.dataTransfer.getData("text/plain");
    addTask(id);
  }

  async function saveEntry(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try {
      await createEntry.mutateAsync({
        kind, text,
        ...(kind === "decision" ? { rationale } : {}),
        tasks: Object.entries(taskComments).map(([taskId, comment]) => ({ taskId, comment }))
      });
      setText("");
      setRationale("");
      setTaskComments({});
      toast({ title: "Запись добавлена" });
    } catch (error) {
      toast({ title: "Не удалось добавить запись", description: describeAuthError(error), tone: "danger" });
    } finally { setBusy(false); }
  }

  async function saveRelation(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!targetId) return;
    try {
      await createRelation.mutateAsync({ type: relationType, toProjectId: targetId });
      setTargetId("");
      toast({ title: "Связь добавлена" });
    } catch (error) {
      toast({ title: "Не удалось добавить связь", description: describeAuthError(error), tone: "danger" });
    }
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="project-logbook-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="project-logbook-heading" className="text-lg font-semibold">Бортовой журнал</h2>
            <p className="mt-1 max-w-2xl text-sm text-subtle-foreground">Наблюдения, решения и причины изменений — с датой и автором.</p>
          </div>
        </div>

        <form onSubmit={(event) => void saveEntry(event)} className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap gap-2">
            <Select aria-label="Тип записи" value={kind} onChange={(event) => setKind(event.target.value as ProjectLogKind)} className="w-48">
              {KINDS.map((value) => <option key={value} value={value}>{PROJECT_LOG_KIND_LABEL[value]}</option>)}
            </Select>
          </div>
          <Textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={5000} rows={3} placeholder="Что произошло, какое решение приняли или почему меняется план?" aria-label="Текст записи журнала" required />
          {kind === "decision" ? (
            <label className="block space-y-1 text-sm">
              <span>Обоснование решения</span>
              <Textarea value={rationale} onChange={(event) => setRationale(event.target.value)} maxLength={5000} rows={2} required />
            </label>
          ) : null}

          {tasksOn ? (
            <div
              onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={cx("space-y-2 rounded-lg border border-dashed p-3 transition-colors", dragOver ? "border-accent bg-accent/10" : "border-border")}
              aria-label="Задачи, связанные с новой записью"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">Задачи в записи</span>
                <Select aria-label="Добавить задачу ссылкой" value="" onChange={(event) => addTask(event.target.value)} className="max-w-full sm:w-72">
                  <option value="">Добавить существующую задачу…</option>
                  {availableTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                </Select>
              </div>
              {Object.keys(taskComments).length === 0 ? (
                <p className="text-xs text-subtle-foreground">Перетащите сюда задачу из другого проекта или выберите её в списке. Задача останется в исходном проекте.</p>
              ) : Object.entries(taskComments).map(([taskId, comment]) => {
                const task = tasks.find((item) => item.id === taskId);
                if (!task) return null;
                const sourceProject = projects.find((item) => item.id === task.projectId);
                return (
                  <div key={taskId} className="grid gap-2 rounded-md bg-background p-2 sm:grid-cols-[minmax(0,1fr)_minmax(14rem,1fr)_auto] sm:items-center">
                    <button type="button" className="min-w-0 truncate text-left text-sm font-medium hover:underline" onClick={() => openProjectTask(task.projectId ?? projectId, task.id)} title="Открыть исходную задачу">{task.title}</button>
                    <Input value={comment} onChange={(event) => setTaskComments((current) => ({ ...current, [taskId]: event.target.value }))} placeholder="Комментарий к задаче в журнале" aria-label={`Комментарий к задаче ${task.title}`} maxLength={2000} />
                    <div className="flex items-center justify-between gap-2 sm:justify-end">
                      <span className="max-w-36 truncate text-xs text-subtle-foreground">{sourceProject?.name ?? "Без проекта"}</span>
                      <Button size="sm" variant="ghost" type="button" aria-label={`Убрать задачу ${task.title} из записи`} onClick={() => setTaskComments((current) => { const next = { ...current }; delete next[taskId]; return next; })}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={busy || !text.trim() || (kind === "decision" && !rationale.trim())}><Plus className="h-4 w-4" /> Добавить запись</Button>
          </div>
        </form>

        {isLoading ? <Skeleton className="h-36 w-full" /> : isError ? (
          <EmptyState icon={BookOpenText} title="Журнал не загружен" description="Проверьте соединение и повторите загрузку." action={<Button size="sm" variant="outline" onClick={() => void refetch()}>Повторить</Button>} />
        ) : entries?.length ? (
          <ol className="divide-y divide-border">
            {entries.map((entry) => (
              <li key={entry.id} className="py-4 first:pt-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={entry.kind === "decision" ? "accent" : "neutral"}>{PROJECT_LOG_KIND_LABEL[entry.kind]}</Badge>
                      <span className="text-xs text-subtle-foreground">{entry.authorName} · <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString("ru-RU")}</time></span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{entry.text}</p>
                    {entry.rationale ? <p className="mt-1 whitespace-pre-wrap text-sm text-subtle-foreground"><strong>Обоснование:</strong> {entry.rationale}</p> : null}
                  </div>
                  {entry.mine ? <Button size="sm" variant="ghost" aria-label="Удалить запись журнала" onClick={() => removeEntry.mutate(entry.id, { onError: (error) => toast({ title: "Не удалось удалить запись", description: describeAuthError(error), tone: "danger" }) })}><Trash2 className="h-4 w-4" /></Button> : null}
                </div>
                {entry.tasks.length ? (
                  <ul className="mt-3 space-y-2 pl-3 sm:ml-2 border-l border-border">
                    {entry.tasks.map((task) => (
                      <li key={task.id} className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <button type="button" className="truncate font-medium hover:underline" onClick={() => openProjectTask(task.projectId ?? projectId, task.id)}>{task.title}</button>
                          <span className="text-xs text-subtle-foreground">{task.projectName ?? "Без проекта"} · {task.status}</span>
                        </div>
                        {task.comment ? <p className="mt-1 whitespace-pre-wrap text-sm text-subtle-foreground">{task.comment}</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        ) : <EmptyState icon={BookOpenText} title="Журнал пока пуст" description="Зафиксируйте первое наблюдение, решение или изменение." />}
      </section>

      <section aria-labelledby="project-relations-heading" className="space-y-4">
        <div>
          <h2 id="project-relations-heading" className="text-lg font-semibold">Связи проектов</h2>
          <p className="mt-1 max-w-2xl text-sm text-subtle-foreground">Направление читается слева направо: текущий проект → выбранный проект. Связанные проекты считаются парой.</p>
        </div>
        <form onSubmit={(event) => void saveRelation(event)} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 sm:flex-row">
          <Select value={relationType} onChange={(event) => setRelationType(event.target.value as ProjectRelationType)} aria-label="Тип связи" className="sm:w-52">
            {RELATIONS.map((type) => <option key={type} value={type}>{PROJECT_RELATION_LABEL[type]}</option>)}
          </Select>
          <Select value={targetId} onChange={(event) => setTargetId(event.target.value)} aria-label="Связанный проект" className="min-w-0 flex-1">
            <option value="">Выберите проект…</option>
            {otherProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </Select>
          <Button size="sm" type="submit" disabled={!targetId || createRelation.isPending}><Link2 className="h-4 w-4" /> Добавить связь</Button>
        </form>
        {relationsLoading ? <Skeleton className="h-24 w-full" /> : relationsError ? <p role="alert" className="text-sm text-destructive">Не удалось загрузить связи проектов.</p> : (
          <div className="grid gap-6 md:grid-cols-3">
            <RelationGroup title="Предшественники" projectId={projectId} relations={relations ?? []} side="predecessors" onDelete={(id) => removeRelation.mutate(id)} />
            <RelationGroup title="Последователи" projectId={projectId} relations={relations ?? []} side="successors" onDelete={(id) => removeRelation.mutate(id)} />
            <RelationGroup title="Связанные проекты" projectId={projectId} relations={relations ?? []} side="related" onDelete={(id) => removeRelation.mutate(id)} />
          </div>
        )}
      </section>
    </div>
  );
}

function RelationGroup({ title, projectId, relations, side, onDelete }: {
  title: string; projectId: string; relations: ProjectRelation[];
  side: "predecessors" | "successors" | "related"; onDelete: (id: string) => void;
}): React.ReactElement {
  const rows = relations.filter((item) => {
    if (side === "related") return item.type === "related";
    if (item.type === "related") return false;
    return side === "successors" ? item.toProjectId === projectId : item.fromProjectId === projectId;
  });
  return (
    <PanelSection title={title} actions={<span className="text-xs tabular-nums text-subtle-foreground">{rows.length}</span>}>
      {rows.length ? <ul className="space-y-2">{rows.map((item) => {
        const projectName = item.fromProjectId === projectId ? item.toProjectName : item.fromProjectName;
        const direction = side === "successors" ? `← ${PROJECT_RELATION_LABEL[item.type].toLowerCase()}` : side === "related" ? PROJECT_RELATION_LABEL[item.type] : `${PROJECT_RELATION_LABEL[item.type]} →`;
        return <li key={item.id} className="flex min-w-0 items-start justify-between gap-2 border-b border-border py-2 last:border-0"><div className="min-w-0"><p className="truncate text-sm font-medium" title={projectName}>{projectName}</p><p className="text-xs text-subtle-foreground">{direction}</p></div>{item.mine ? <Button size="sm" variant="ghost" aria-label={`Удалить связь с проектом ${projectName}`} onClick={() => onDelete(item.id)}><Trash2 className="h-4 w-4" /></Button> : null}</li>;
      })}</ul> : <p className="py-2 text-sm text-subtle-foreground">Пока нет связей</p>}
    </PanelSection>
  );
}
