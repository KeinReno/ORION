"use client";

import { useCreateTaskView, useDeleteTaskView, useTaskViews } from "@orion/core-react";
import type { Project, SavedTaskView } from "@orion/shared-types";
import { Button, ConfirmDialog, Input, Modal, Skeleton, cx, useToast } from "@orion/ui";
import { BookmarkPlus, X } from "lucide-react";
import { useState, type FormEvent } from "react";

/**
 * Saved task views (v0.14) — a named filter preset in the tasks panel header.
 *
 * Scope note: `taskViewFiltersSchema` also carries `statuses`/`priorities`/`due`,
 * but the board has no controls for those (it groups by them instead of
 * filtering), so a view saved here only stores what the panel can actually
 * restore — the search string and the project. Storing a filter the panel
 * can't apply back would be a lie the UI tells the user.
 */
export interface SavedViewCriteria {
  search: string;
  projectId: string | null;
}

export function SavedViewsBar({
  workspaceId,
  projects,
  current,
  onApply
}: {
  workspaceId: string | undefined;
  projects: Project[];
  current: SavedViewCriteria;
  onApply: (criteria: SavedViewCriteria) => void;
}): React.ReactElement {
  const { data: views, isLoading } = useTaskViews(workspaceId);
  const createView = useCreateTaskView(workspaceId);
  const deleteView = useDeleteTaskView(workspaceId);
  const { toast } = useToast();

  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<SavedTaskView | null>(null);

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!name.trim()) return;
    await createView.mutateAsync({
      name: name.trim(),
      filters: { search: current.search || undefined, projectId: current.projectId }
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
        const isActive =
          (view.filters.search ?? "") === current.search && (view.filters.projectId ?? null) === current.projectId;
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
              onClick={() =>
                onApply({ search: view.filters.search ?? "", projectId: view.filters.projectId ?? null })
              }
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
            Вид запоминает текущий поиск и фильтр по проекту.
            {current.search ? ` Поиск: «${current.search}».` : ""}
            {activeProjectName ? ` Проект: ${activeProjectName}.` : ""}
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
