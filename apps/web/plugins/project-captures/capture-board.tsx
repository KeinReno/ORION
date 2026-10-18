"use client";

import {
  useCreateProjectCapture,
  useDeleteProjectCapture,
  useProjectCaptures,
  usePromoteProjectCapture,
  useUpdateProjectCapture
} from "@orion/core-react";
import {
  PROJECT_CAPTURE_SEVERITY_LABEL,
  PROJECT_CAPTURE_STATUS_LABEL,
  type ProjectCapture,
  type ProjectCaptureKind,
  type ProjectCaptureSeverity,
  type ProjectCaptureStatus,
  type UpdateProjectCaptureInput
} from "@orion/shared-types";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  MarkdownEditor,
  MarkdownToolbar,
  SegmentedControl,
  Skeleton,
  useToast,
  type MarkdownEditorApi
} from "@orion/ui";
import { Bug, Lightbulb, ListTodo, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProjectTabSlotProps } from "../../lib/extensions/contracts";
import { describeAuthError, openEntity, relativeTime } from "../../lib/extensions/host-api";

const COPY: Record<
  ProjectCaptureKind,
  { newTitle: string; newButton: string; emptyTitle: string; emptyDescription: string; placeholder: string; deleteNoun: string }
> = {
  idea: {
    newTitle: "Новая идея",
    newButton: "Новая идея",
    emptyTitle: "Пока нет идей",
    emptyDescription: "Зафиксируйте мысль, пока она не ушла. Потом из неё можно сделать задачу этого проекта.",
    placeholder: "Что пришло в голову…",
    deleteNoun: "идею"
  },
  problem: {
    newTitle: "Новая проблема",
    newButton: "Новая запись",
    emptyTitle: "Пока ничего не записано",
    emptyDescription: "Сюда — то, что не нравится в проекте, найденные баги и то, что нужно поправить.",
    placeholder: "Что не так…",
    deleteNoun: "запись"
  }
};

const SEVERITY_OPTIONS: { value: ProjectCaptureSeverity; label: string }[] = [
  { value: "annoyance", label: PROJECT_CAPTURE_SEVERITY_LABEL.annoyance },
  { value: "bug", label: PROJECT_CAPTURE_SEVERITY_LABEL.bug },
  { value: "fix", label: PROJECT_CAPTURE_SEVERITY_LABEL.fix }
];

type Filter = ProjectCaptureStatus;

interface Draft {
  title: string;
  body: string;
  severity: ProjectCaptureSeverity | null;
}

function same(item: ProjectCapture, draft: Draft): boolean {
  return item.title === draft.title && item.body === draft.body && item.severity === draft.severity;
}

function toInput(kind: ProjectCaptureKind, item: ProjectCapture, draft: Draft): UpdateProjectCaptureInput {
  const input: UpdateProjectCaptureInput = {};
  const title = draft.title.trim();
  if (title && title !== item.title) input.title = title;
  if (draft.body !== item.body) input.body = draft.body;
  if (kind === "problem" && draft.severity && draft.severity !== item.severity) input.severity = draft.severity;
  return input;
}

/**
 * Shared board for the two project plugins. Ideas and problems are the same
 * shape (a note pinned to this project) with different words and, for problems,
 * a severity. Turning one into a task is explicit — the text stays here.
 */
export function ProjectCaptureBoard({
  workspaceId,
  projectId,
  kind
}: ProjectTabSlotProps & { kind: ProjectCaptureKind }): React.ReactElement {
  const copy = COPY[kind];
  const { data: items, isLoading, isError } = useProjectCaptures(workspaceId, projectId, kind);
  const create = useCreateProjectCapture(workspaceId, projectId, kind);
  const update = useUpdateProjectCapture(workspaceId, projectId, kind);
  const remove = useDeleteProjectCapture(workspaceId, projectId, kind);
  const promote = usePromoteProjectCapture(workspaceId, projectId, kind);
  const { toast } = useToast();

  const [filter, setFilter] = useState<Filter>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);
  const editorApi = useRef<MarkdownEditorApi | null>(null);
  const draftRef = useRef(draft);
  const selectedRef = useRef<ProjectCapture | null>(null);
  const updateRef = useRef(update.mutate);
  draftRef.current = draft;
  updateRef.current = update.mutate;

  const list = items ?? [];
  const selected = list.find((item) => item.id === selectedId) ?? null;
  selectedRef.current = selected;
  const visible = list.filter((item) => item.status === filter);

  useEffect(() => {
    if (!selected) return;
    setDraft({ title: selected.title, body: selected.body, severity: selected.severity });
    // Reload the editor only when the user picks another row. A save refreshes
    // the same id and must not wipe what they are typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  useEffect(() => {
    if (!selected || !draft || same(selected, draft)) return;
    if (!draft.title.trim()) return;
    const input = toInput(kind, selected, draft);
    if (Object.keys(input).length === 0) return;
    const captureId = selected.id;
    const timer = window.setTimeout(() => {
      update.mutate(
        { captureId, input },
        { onError: (error) => toast({ title: "Не удалось сохранить", description: describeAuthError(error), tone: "danger" }) }
      );
    }, 800);
    return () => window.clearTimeout(timer);
  }, [draft, selected, kind, update, toast]);

  // Leaving the tab must not drop the last keystrokes still waiting on the debounce.
  useEffect(() => {
    return () => {
      const item = selectedRef.current;
      const next = draftRef.current;
      if (!item || !next || same(item, next) || !next.title.trim()) return;
      const input = toInput(kind, item, next);
      if (Object.keys(input).length === 0) return;
      updateRef.current({ captureId: item.id, input });
    };
  }, [kind]);

  function flush(): void {
    const item = selectedRef.current;
    const next = draftRef.current;
    if (!item || !next || same(item, next) || !next.title.trim()) return;
    const input = toInput(kind, item, next);
    if (Object.keys(input).length === 0) return;
    update.mutate(
      { captureId: item.id, input },
      { onError: (error) => toast({ title: "Не удалось сохранить", description: describeAuthError(error), tone: "danger" }) }
    );
  }

  async function add(): Promise<void> {
    flush();
    try {
      const created = await create.mutateAsync(
        kind === "problem" ? { title: copy.newTitle, body: "", severity: "annoyance" } : { title: copy.newTitle, body: "" }
      );
      setFilter("open");
      setSelectedId(created.id);
      setDraft({ title: created.title, body: created.body, severity: created.severity });
    } catch (error) {
      toast({ title: "Не удалось создать запись", description: describeAuthError(error), tone: "danger" });
    }
  }

  function setStatus(status: "open" | "dismissed"): void {
    if (!selected) return;
    update.mutate(
      { captureId: selected.id, input: { status } },
      {
        onSuccess: () => setFilter(status),
        onError: (error) => toast({ title: "Не удалось обновить", description: describeAuthError(error), tone: "danger" })
      }
    );
  }

  async function makeTask(): Promise<void> {
    if (!selected || !draft || !draft.title.trim()) return;
    try {
      if (!same(selected, draft)) {
        const input = toInput(kind, selected, draft);
        if (Object.keys(input).length > 0) {
          await update.mutateAsync({ captureId: selected.id, input });
        }
      }
      await promote.mutateAsync(selected.id);
      setFilter("promoted");
      toast({ title: "Задача создана в этом проекте", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось создать задачу", description: describeAuthError(error), tone: "danger" });
    }
  }

  function confirmDelete(): void {
    if (!selected) return;
    const id = selected.id;
    setPendingDelete(false);
    remove.mutate(id, {
      onSuccess: () => {
        setSelectedId(null);
        setDraft(null);
        toast({ title: "Удалено" });
      },
      onError: (error) => toast({ title: "Не удалось удалить", description: describeAuthError(error), tone: "danger" })
    });
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (isError) {
    return <EmptyState tone="danger" title="Не удалось загрузить записи" description="Проверьте, что API запущен, и откройте вкладку ещё раз." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          aria-label="Какие записи показать"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "open", label: `Открытые${count(list, "open")}` },
            { value: "promoted", label: `В задачах${count(list, "promoted")}` },
            { value: "dismissed", label: `Закрытые${count(list, "dismissed")}` }
          ]}
        />
        {/* Secondary next to the project's own «Задача»; an empty board offers it in its empty state instead. */}
        {list.length > 0 ? (
          <Button size="sm" variant="outline" onClick={() => void add()} disabled={create.isPending}>
            <Plus className="h-4 w-4" />
            {copy.newButton}
          </Button>
        ) : null}
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={kind === "idea" ? Lightbulb : Bug}
          title={copy.emptyTitle}
          description={copy.emptyDescription}
          action={
            <Button size="sm" onClick={() => void add()} disabled={create.isPending}>
              {copy.newButton}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto lg:max-h-[32rem]">
            {visible.length === 0 ? (
              <li className="px-2 py-6 text-center text-sm text-muted-foreground">В этом списке пусто</li>
            ) : (
              visible.map((item) => {
                const active = item.id === selectedId;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        flush();
                        setSelectedId(item.id);
                      }}
                      className={
                        active
                          ? "w-full rounded-lg bg-white/10 px-3 py-2 text-left"
                          : "w-full rounded-lg px-3 py-2 text-left hover:bg-white/5"
                      }
                    >
                      <span className="block truncate text-sm">{item.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {kind === "problem" && item.severity ? `${PROJECT_CAPTURE_SEVERITY_LABEL[item.severity]} · ` : ""}
                        {relativeTime(item.createdAt)}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          {selected && draft ? (
            <div className="flex min-w-0 flex-col gap-3">
              <Input
                value={draft.title}
                aria-label="Заголовок"
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                onBlur={flush}
              />
              {!draft.title.trim() ? <p className="text-xs text-destructive">Нужен заголовок</p> : null}
              {kind === "problem" ? (
                <SegmentedControl
                  aria-label="Что это за запись"
                  size="sm"
                  value={draft.severity ?? "annoyance"}
                  onChange={(severity) => setDraft({ ...draft, severity })}
                  options={SEVERITY_OPTIONS}
                />
              ) : null}
              <div className="space-y-2 rounded-xl border border-border-strong bg-card/60 px-3 py-2 focus-within:border-accent/70 focus-within:ring-2 focus-within:ring-accent/25">
                <MarkdownToolbar apiRef={editorApi} />
                <MarkdownEditor
                  apiRef={editorApi}
                  value={draft.body}
                  onChange={(body) => setDraft({ ...draft, body })}
                  onSave={flush}
                  placeholder={copy.placeholder}
                  className="min-h-[14rem]"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selected.taskId ? (
                  <Button size="sm" variant="outline" onClick={() => openEntity("task", selected.taskId as string)}>
                    <ListTodo className="h-4 w-4" />
                    Открыть задачу
                  </Button>
                ) : selected.status !== "dismissed" ? (
                  <Button size="sm" onClick={makeTask} disabled={promote.isPending || !draft.title.trim()}>
                    <ListTodo className="h-4 w-4" />
                    Сделать задачей
                  </Button>
                ) : null}
                {selected.status === "dismissed" ? (
                  <Button size="sm" variant="outline" onClick={() => setStatus("open")}>
                    Вернуть
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setStatus("dismissed")}>
                    Не актуально
                  </Button>
                )}
                <Button size="sm" variant="danger" onClick={() => setPendingDelete(true)}>
                  <Trash2 className="h-4 w-4" />
                  Удалить
                </Button>
                <span className="text-xs text-muted-foreground">
                  {update.isPending ? "Сохранение…" : PROJECT_CAPTURE_STATUS_LABEL[selected.status]}
                  {selected.taskId && selected.status !== "promoted" ? " · задача уже есть" : ""}
                </span>
              </div>
            </div>
          ) : (
            <p className="self-center text-sm text-muted-foreground">Выберите запись слева или создайте новую.</p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete}
        title={`Удалить ${copy.deleteNoun}?`}
        description="Сама запись пропадёт. Задача, если вы её уже создали, останется в проекте."
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(false)}
      />
    </div>
  );
}

function count(items: ProjectCapture[], status: ProjectCaptureStatus): string {
  const n = items.filter((item) => item.status === status).length;
  return n > 0 ? ` · ${n}` : "";
}
