"use client";

import {
  useCreateNote,
  useDeleteNote,
  useNotes,
  useOpenDailyNote,
  useProjects,
  usePurgeNote,
  useRestoreNote,
  useUpdateNote
} from "@orion/core-react";
import { TagManager } from "./tag-manager";
import { ApiError } from "@orion/core";
import type { Note, NoteView } from "@orion/shared-types";
import { isNoteConflictPayload, type AutosaveConflict } from "../lib/note-autosave";
import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  IconButton,
  Input,
  PanelHeader,
  PanelShell,
  SegmentedControl,
  Sheet,
  Skeleton,
  cx,
  isTypingTarget,
  useDebouncedValue,
  usePanelVisible,
  useResizeWidth,
  useToast
} from "@orion/ui";
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  Copy,
  FileStack,
  FileText,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  Tags,
  Trash2,
  TriangleAlert
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDayTitle, projectColor, relativeTime } from "../lib/format";
import { describeError } from "../lib/error-message";
import { FilterChip } from "../components/filter-chip";
import { useFocusedNoteId } from "../lib/panel-bus";
import { nextListId } from "../lib/list-nav";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { noteListPreview } from "../lib/note-list-preview";
import { NoteEditor, contentTime, type NoteEditorInput } from "./note-editor";

type SortKey = "updated" | "created" | "title";

const NEW_NOTE = "__new__";
const TWO_PANE_MIN = 720;

export function NotesPanel(): React.ReactElement {
  const panelVisible = usePanelVisible();
  const { workspace } = useActiveWorkspace();
  const { isEnabled } = useEnabledModules();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);
  const [view, setView] = useState<NoteView>("active");
  const [templatesView, setTemplatesView] = useState(false);
  const trash = view === "trash";
  const activeView = view === "active";
  const { data: notes, isLoading, isError, error, refetch } = useNotes(workspace?.id, debouncedQuery, view, templatesView);
  // Templates for the "Новая из шаблона" menu — a small, always-loaded list.
  const { data: templates } = useNotes(workspace?.id, "", "active", true);
  // Active projects of this workspace — the editor's "Проект" select and the
  // project chip in the list. Same source as TasksPanel.
  const { data: projectList } = useProjects(isEnabled("projects") ? workspace?.id : undefined);
  const createNote = useCreateNote(workspace?.id);
  const updateNote = useUpdateNote(workspace?.id);
  const deleteNote = useDeleteNote(workspace?.id);
  const restoreNote = useRestoreNote(workspace?.id);
  const purgeNote = usePurgeNote(workspace?.id);
  const openDaily = useOpenDailyNote(workspace?.id);
  const { toast } = useToast();

  const [wrapRef, width] = useResizeWidth<HTMLDivElement>();
  const twoPane = width >= TWO_PANE_MIN;

  const [sort, setSort] = useState<SortKey>("updated");
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<"any" | "all">("any");
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const [pendingDelete, setPendingDelete] = useState<Note | null>(null);
  const [pendingPurge, setPendingPurge] = useState<Note | null>(null);
  // Bumped after a revision restore to remount NoteEditor on the fresh note.
  const [editorReloadKey, setEditorReloadKey] = useState(0);

  // Switching list (view / templates) closes any open editor.
  useEffect(() => {
    setSelectedId(null);
  }, [view, templatesView]);

  const focusedNoteId = useFocusedNoteId();
  useEffect(() => {
    if (focusedNoteId) {
      setView("active");
      setTemplatesView(false);
      setSelectedId(focusedNoteId);
    }
  }, [focusedNoteId]);

  function toggleTagFilter(tag: string): void {
    setTagFilters((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]));
  }

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const note of notes ?? []) for (const tag of note.tags) set.add(tag);
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [notes]);

  // The server already applies the search filter (see useNotes above) —
  // this only narrows by tag and orders. Trash: newest-deleted first;
  // archive: newest-archived first; both without pinning. Otherwise pinned
  // notes lead, then the chosen sort ("updated" = content edit time).
  const visible = useMemo(() => {
    const filtered = (notes ?? []).filter((n) => {
      if (tagFilters.length === 0) return true;
      return tagMode === "all"
        ? tagFilters.every((t) => n.tags.includes(t))
        : tagFilters.some((t) => n.tags.includes(t));
    });
    if (trash) {
      return [...filtered].sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));
    }
    if (view === "archive") {
      return [...filtered].sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
    }
    return [...filtered].sort((a, b) => {
      const pinDiff = Number(b.pinnedAt !== null) - Number(a.pinnedAt !== null);
      if (pinDiff !== 0) return pinDiff;
      if (sort === "title") return a.title.localeCompare(b.title, "ru");
      if (sort === "created") return b.createdAt.localeCompare(a.createdAt);
      return contentTime(b).localeCompare(contentTime(a));
    });
  }, [notes, tagFilters, tagMode, sort, trash, view]);

  const selected = selectedId && selectedId !== NEW_NOTE ? (notes ?? []).find((n) => n.id === selectedId) ?? null : null;
  const composing = selectedId === NEW_NOTE;

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!panelVisible || composing || pendingDelete || pendingPurge || tagManagerOpen) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const current = selectedIdRef.current && selectedIdRef.current !== NEW_NOTE ? selectedIdRef.current : null;
        const next = nextListId(visible.map((note) => note.id), current, event.key === "ArrowDown" ? 1 : -1);
        if (next) {
          selectedIdRef.current = next;
          setSelectedId(next);
        }
        return;
      }
      if (event.key === "Enter" && selectedIdRef.current && selectedIdRef.current !== NEW_NOTE && !trash) {
        event.preventDefault();
        setSelectedId(selectedIdRef.current);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelVisible, composing, pendingDelete, pendingPurge, tagManagerOpen, visible, selectedId, trash]);

  async function handleCreate(input: NoteEditorInput): Promise<void> {
    const created = await createNote.mutateAsync({ ...input, isTemplate: templatesView });
    setSelectedId(created.id);
    toast({ title: templatesView ? "Шаблон создан" : "Заметка создана", tone: "success" });
  }

  async function createFromTemplate(template: Note): Promise<void> {
    const created = await createNote.mutateAsync({
      title: template.title,
      body: template.body,
      tags: template.tags
    });
    setTemplatesView(false);
    setSelectedId(created.id);
    toast({ title: "Заметка из шаблона", tone: "success" });
  }

  function handleToggleTemplate(note: Note): void {
    updateNote.mutate(
      { noteId: note.id, input: { isTemplate: !note.isTemplate } },
      {
        onSuccess: () => {
          setSelectedId((cur) => (cur === note.id ? null : cur));
          toast({ title: note.isTemplate ? "Больше не шаблон" : "Теперь это шаблон", tone: "success" });
        }
      }
    );
  }

  function handleToggleArchive(note: Note): void {
    updateNote.mutate(
      { noteId: note.id, input: { archivedAt: note.archivedAt ? null : new Date().toISOString() } },
      {
        onSuccess: () => {
          setSelectedId((cur) => (cur === note.id ? null : cur));
          toast({ title: note.archivedAt ? "Из архива" : "В архиве", tone: "success" });
        }
      }
    );
  }

  /**
   * S11: the CAS save call `NoteAutosave` drives. Throws the note's
   * `AutosaveConflict` shape (not a generic error) on a 409 so the editor's
   * conflict UI can offer "reload latest" with the server's real content,
   * instead of a plain error toast that would tell the user nothing about
   * what happened or what to do about it.
   */
  async function handleSave(
    id: string,
    input: NoteEditorInput,
    expectedRevision: number,
    opts?: { silent?: boolean }
  ): Promise<Note> {
    try {
      const updated = await updateNote.mutateAsync({ noteId: id, input: { ...input, expectedRevision } });
      if (!opts?.silent) toast({ title: "Сохранено", tone: "success" });
      return updated;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && isNoteConflictPayload(err.details)) {
        const payload = err.details;
        const conflict: AutosaveConflict = {
          conflict: true,
          currentRevision: payload.currentRevision,
          current: {
            title: payload.current.title as string,
            body: payload.current.body as string,
            tags: payload.current.tags as string[],
            eventAt: (payload.current.eventAt as string | null) ?? null,
            projectId: (payload.current.projectId as string | null) ?? null
          }
        };
        throw conflict;
      }
      throw err;
    }
  }

  async function handleDuplicate(note: Note): Promise<void> {
    const created = await createNote.mutateAsync({
      title: `${note.title} (копия)`,
      body: note.body,
      tags: note.tags,
      isTemplate: note.isTemplate
    });
    setSelectedId(created.id);
    toast({ title: "Скопировано", tone: "success" });
  }

  function handleTogglePin(note: Note): void {
    updateNote.mutate(
      { noteId: note.id, input: { pinnedAt: note.pinnedAt ? null : new Date().toISOString() } },
      { onSuccess: () => toast({ title: note.pinnedAt ? "Откреплено" : "Закреплено", tone: "success" }) }
    );
  }

  function confirmDelete(): void {
    const note = pendingDelete;
    if (!note) return;
    setPendingDelete(null);
    deleteNote.mutate(note.id, {
      onSuccess: () => {
        setSelectedId((cur) => (cur === note.id ? null : cur));
        toast({ title: "Перемещено в корзину", tone: "default" });
      }
    });
  }

  function handleRestore(note: Note): void {
    restoreNote.mutate(note.id, { onSuccess: () => toast({ title: "Восстановлено", tone: "success" }) });
  }

  function confirmPurge(): void {
    const note = pendingPurge;
    if (!note) return;
    setPendingPurge(null);
    purgeNote.mutate(note.id, { onSuccess: () => toast({ title: "Удалено навсегда", tone: "default" }) });
  }

  function handleOpenDaily(): void {
    openDaily.mutate(undefined, {
      onSuccess: (note) => {
        setView("active");
        setSelectedId(note.id);
        toast({ title: `Ежедневная: ${note.dailyOn ? formatDayTitle(note.dailyOn) : "сегодня"}`, tone: "success" });
      }
    });
  }

  const list = (
    <div className="orion-scroll flex-1 overflow-y-auto p-3">
      {!trash && (activeView || allTags.length > 0) ? (
        <div className="mb-2 flex flex-wrap items-center gap-1 px-1">
          {activeView ? (
            <FilterChip active={templatesView} onClick={() => setTemplatesView((v) => !v)}>
              Шаблоны{templates && templates.length > 0 ? ` · ${templates.length}` : ""}
            </FilterChip>
          ) : null}
          {allTags.length > 0 ? (
            <>
              <FilterChip active={tagFilters.length === 0} onClick={() => setTagFilters([])}>
                Все
              </FilterChip>
              {allTags.map((tag) => (
                <FilterChip key={tag} active={tagFilters.includes(tag)} onClick={() => toggleTagFilter(tag)} color={tag}>
                  {tag}
                </FilterChip>
              ))}
              {tagFilters.length >= 2 ? (
                <SegmentedControl<"any" | "all">
                  value={tagMode}
                  onChange={setTagMode}
                  size="sm"
                  options={[
                    { value: "any", label: "ИЛИ" },
                    { value: "all", label: "И" }
                  ]}
                />
              ) : null}
              <IconButton label="Управление тегами" size="sm" onClick={() => setTagManagerOpen(true)}>
                <Tags className="h-4 w-4" />
              </IconButton>
            </>
          ) : null}
        </div>
      ) : null}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : isError ? (
        <div className="p-3">
          <EmptyState
            icon={TriangleAlert}
            tone="danger"
            title="Не удалось загрузить заметки"
            description={describeError(error)}
            action={
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                Повторить
              </Button>
            }
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="p-3">
          <EmptyState
            icon={trash ? Trash2 : view === "archive" ? Archive : FileText}
            title={
              trash
                ? "Корзина пуста"
                : view === "archive"
                  ? "В архиве пусто"
                  : query || tagFilters.length > 0
                    ? "Ничего не найдено"
                    : templatesView
                      ? "Шаблонов пока нет"
                      : "Заметок пока нет"
            }
            description={
              trash
                ? "Удалённые заметки хранятся здесь 30 дней, потом стираются насовсем."
                : view === "archive"
                  ? "Заметки из архива не показываются в общем списке, но их не удаляют."
                  : query || tagFilters.length > 0
                    ? "Сбросьте поиск или фильтр по тегам — в этом списке заметки есть."
                    : templatesView
                      ? "Создайте шаблон кнопкой сверху или отметьте существующую заметку как шаблон."
                      : "Создайте первую заметку кнопкой сверху."
            }
            action={
              query || tagFilters.length > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    setTagFilters([]);
                  }}
                >
                  Сбросить фильтры
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ul className="space-y-1">
          {visible.map((note) => {
            const active = note.id === selectedId;
            const project = note.projectId ? (projectList ?? []).find((p) => p.id === note.projectId) : undefined;
            const preview = noteListPreview(note.body);
            return (
              <li key={note.id}>
                <div
                  role={trash ? undefined : "button"}
                  tabIndex={trash ? undefined : 0}
                  onClick={trash ? undefined : () => setSelectedId(note.id)}
                  onKeyDown={
                    trash
                      ? undefined
                      : (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedId(note.id);
                          }
                        }
                  }
                  className={cx(
                    "group flex items-start gap-2 rounded-xl border px-3 py-2.5 transition-colors",
                    trash
                      ? "border-transparent"
                      : cx(
                          "cursor-pointer",
                          active
                            ? "border-accent/40 bg-accent/[0.07]"
                            : "border-transparent hover:border-border hover:bg-card-hover"
                        )
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                      {!trash && note.pinnedAt ? <Pin className="h-3 w-3 shrink-0 text-accent" /> : null}
                      <span className="truncate">{note.title || "Без заголовка"}</span>
                    </p>
                    {preview ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{preview}</p>
                    ) : null}
                    <p className="mt-1 flex items-center gap-1.5 text-2xs text-subtle-foreground">
                      {project ? (
                        <span
                          style={projectColor(project.name)}
                          className="inline-flex max-w-[9rem] shrink-0 truncate rounded-full border px-1.5 py-0 text-2xs font-medium"
                        >
                          {project.name}
                        </span>
                      ) : null}
                      <span className="truncate">
                        {trash && note.deletedAt
                          ? `Удалено ${relativeTime(note.deletedAt)}`
                          : relativeTime(contentTime(note))}
                      </span>
                    </p>
                  </div>
                  <div className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-sm:opacity-100">
                    <DropdownMenu
                      trigger={({ toggle }) => (
                        <IconButton
                          label="Действия"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle();
                          }}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </IconButton>
                      )}
                      items={
                        trash
                          ? [
                              { label: "Восстановить", icon: RotateCcw, onSelect: () => handleRestore(note) },
                              "separator",
                              {
                                label: "Удалить навсегда",
                                icon: Trash2,
                                tone: "danger",
                                onSelect: () => setPendingPurge(note)
                              }
                            ]
                          : [
                              {
                                label: note.pinnedAt ? "Открепить" : "Закрепить",
                                icon: note.pinnedAt ? PinOff : Pin,
                                onSelect: () => handleTogglePin(note)
                              },
                              {
                                label: note.archivedAt ? "Из архива" : "В архив",
                                icon: note.archivedAt ? ArchiveRestore : Archive,
                                onSelect: () => handleToggleArchive(note)
                              },
                              { label: "Дублировать", icon: Copy, onSelect: () => void handleDuplicate(note) },
                              {
                                label: note.isTemplate ? "Убрать из шаблонов" : "Сделать шаблоном",
                                icon: FileStack,
                                onSelect: () => handleToggleTemplate(note)
                              },
                              "separator",
                              { label: "Удалить", icon: Trash2, tone: "danger", onSelect: () => setPendingDelete(note) }
                            ]
                      }
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  const editor =
    composing || selected ? (
      <NoteEditor
        key={`${selected?.id ?? NEW_NOTE}:${editorReloadKey}`}
        note={selected}
        workspaceId={workspace?.id}
        projects={isEnabled("projects") ? (projectList ?? []) : undefined}
        busy={createNote.isPending}
        onCreate={handleCreate}
        onSave={handleSave}
        onClose={() => setSelectedId(null)}
        onReload={() => setEditorReloadKey((k) => k + 1)}
        onTogglePin={handleTogglePin}
        onToggleArchive={handleToggleArchive}
        onDuplicate={(n) => void handleDuplicate(n)}
        onToggleTemplate={handleToggleTemplate}
        onDelete={setPendingDelete}
      />
    ) : (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState icon={FileText} title="Выберите заметку" description="Или создайте новую — она откроется здесь." />
      </div>
    );

  return (
    <PanelShell>
      <PanelHeader
        icon={FileText}
        title="Заметки"
        subtitle={notes ? (templatesView ? `${notes.length} шаблонов` : `${notes.length} шт.`) : undefined}
        actions={
          !activeView ? undefined : (
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={handleOpenDaily} disabled={openDaily.isPending}>
                <CalendarDays className="h-4 w-4" /> Сегодня
              </Button>
              <Button size="sm" onClick={() => setSelectedId(NEW_NOTE)}>
                <Plus className="h-4 w-4" /> {templatesView ? "Новый шаблон" : "Новая"}
              </Button>
              {!templatesView && templates && templates.length > 0 ? (
                <DropdownMenu
                  align="end"
                  trigger={({ toggle }) => (
                    <IconButton label="Из шаблона" size="sm" onClick={toggle}>
                      <FileStack className="h-4 w-4" />
                    </IconButton>
                  )}
                  items={templates.map((t) => ({
                    label: t.title || "Без заголовка",
                    icon: FileText,
                    onSelect: () => void createFromTemplate(t)
                  }))}
                />
              ) : null}
            </div>
          )
        }
      >
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск"
            className="pl-8"
            disabled={trash}
          />
        </div>
        {activeView ? (
          <SegmentedControl<SortKey>
            value={sort}
            onChange={setSort}
            size="sm"
            options={[
              { value: "updated", label: "Изменённые" },
              { value: "created", label: "Созданные" },
              { value: "title", label: "А–Я" }
            ]}
          />
        ) : null}
        <SegmentedControl<NoteView>
          value={view}
          onChange={setView}
          size="sm"
          options={[
            { value: "active", label: "Активные" },
            { value: "archive", label: "Архив" },
            { value: "trash", label: "Корзина" }
          ]}
        />
      </PanelHeader>

      <div ref={wrapRef} className="flex min-h-0 flex-1">
        {trash ? (
          <div className="flex min-w-0 flex-1 flex-col">{list}</div>
        ) : twoPane ? (
          <>
            <div className="flex w-[20rem] shrink-0 flex-col border-r border-border">{list}</div>
            <div className="min-w-0 flex-1">{editor}</div>
          </>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 flex-col">{list}</div>
            <Sheet
              open={composing || Boolean(selected)}
              onClose={() => setSelectedId(null)}
              title={composing ? "Новая заметка" : "Заметка"}
              bare
            >
              {editor}
            </Sheet>
          </>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить заметку?"
        description={
          pendingDelete ? `«${pendingDelete.title || "Без заголовка"}» переедет в корзину — можно восстановить.` : undefined
        }
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
      <ConfirmDialog
        open={pendingPurge !== null}
        title="Удалить навсегда?"
        description={pendingPurge ? `«${pendingPurge.title || "Без заголовка"}» — действие необратимо.` : undefined}
        onConfirm={confirmPurge}
        onCancel={() => setPendingPurge(null)}
      />

      <TagManager
        workspaceId={workspace?.id}
        tags={allTags}
        open={tagManagerOpen}
        onClose={() => setTagManagerOpen(false)}
      />
    </PanelShell>
  );
}
