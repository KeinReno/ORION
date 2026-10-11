"use client";

import { useCreateTaskView, useDeleteTaskView, useTaskViews } from "@orion/core-react";
import type { Project, SavedTaskView, TaskViewFilters } from "@orion/shared-types";
import { Button, ConfirmDialog, Input, Modal, Skeleton, cx, useToast } from "@orion/ui";
import { BookmarkPlus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { TaskViewCriteria } from "../../lib/extensions/contracts";

/**
 * Saved task views (v0.14) — a named filter preset in the tasks panel header.
 *
 * A named preset restores every filter carried by the public task-view contract.
 */
function criteriaOf(filters: TaskViewFilters): TaskViewCriteria {
  return {
    search: filters.search ?? "",
    projectId: filters.projectId ?? null,
    due: filters.due ?? "all",
    statuses: filters.statuses ?? [],
    priorities: filters.priorities ?? []
  };
}

function sameCriteria(a: TaskViewCriteria, b: TaskViewCriteria): boolean {
  return a.search === b.search && a.projectId === b.projectId && a.due === b.due &&
    [...a.statuses].sort().join("|") === [...b.statuses].sort().join("|") &&
    [...a.priorities].sort().join("|") === [...b.priorities].sort().join("|");
}

export function SavedViewsBar({
  workspaceId,
  projects,
  current,
  onApply
}: {
  workspaceId: string | undefined;
  projects: Project[];
  current: TaskViewCriteria;
  onApply: (criteria: TaskViewCriteria) => void;
}): React.ReactElement {
  const { data: views, isLoading } = useTaskViews(workspaceId);
  const createView = useCreateTaskView(workspaceId);
  const deleteView = useDeleteTaskView(workspaceId);
  const { toast } = useToast();

  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<SavedTaskView | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!name.trim()) return;
    await createView.mutateAsync({
      name: name.trim(),
      filters: {
        search: current.search || undefined,
        projectId: current.projectId,
        due: current.due,
        statuses: current.statuses,
        priorities: current.priorities
      }
    });
    setName("");
    setSaving(false);
    toast({ title: "Вид сохранён", tone: "success" });
  }

  function confirmDelete(): void {
    const view = pendingDelete;
    if (!view) return;
    setPendingDelete(null);
    deleteView.mutate(view.id, { onSuccess: () => toast({ title: "Вид удалён" }) });
  }

  const activeProjectName = current.projectId
    ? projects.find((project) => project.id === current.projectId)?.name ?? null
    : null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {isLoading ? <Skeleton className="h-6 w-24" /> : null}
      {(views ?? []).map((view) => {
        const isActive = view.id === activeViewId && sameCriteria(criteriaOf(view.filters), current);
        return (
          <span
            key={view.id}
            className={cx(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs",
              isActive ? "border-accent/60 bg-accent/10 text-foreground" : "border-border text-muted-foreground"
            )}
          >
            <button
              type="button"
              className="max-w-40 truncate hover:text-foreground"
              aria-pressed={isActive}
              title={`Применить вид «${view.name}»`}
              onClick={() => {
                onApply(criteriaOf(view.filters));
                setActiveViewId(view.id);
              }}
            >
              {view.name}
            </button>
            <button
              type="button"
              aria-label={`Удалить вид «${view.name}»`}
              className="text-subtle-foreground hover:text-destructive"
              onClick={() => setPendingDelete(view)}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      <Button
        type="button"
        variant="subtle"
        size="sm"
        className="h-6 px-2 text-2xs"
        onClick={() => {
          setName(activeProjectName ? `Проект: ${activeProjectName}` : current.search ? `Поиск: ${current.search}` : "");
          setSaving(true);
        }}
      >
        <BookmarkPlus className="h-3.5 w-3.5" /> Сохранить вид
      </Button>

      <Modal open={saving} onClose={() => setSaving(false)} title="Сохранить вид" size="sm">
        <form onSubmit={save} className="flex flex-col gap-3">
          <Input
            autoFocus
            placeholder="Название вида"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <p className="text-2xs text-subtle-foreground">
            Вид запоминает текущий поиск, проект, срок, статус и приоритет.
            {current.search ? ` Поиск: «${current.search}».` : ""}
            {activeProjectName ? ` Проект: ${activeProjectName}.` : ""}
            {current.due !== "all" ? ` Срок: ${current.due}.` : ""}
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="subtle" size="sm" onClick={() => setSaving(false)}>
              Отмена
            </Button>
            <Button type="submit" size="sm" disabled={createView.isPending || !name.trim()}>
              Сохранить
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить вид?"
        description={pendingDelete ? `«${pendingDelete.name}» — сам фильтр и задачи не пострадают.` : undefined}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
