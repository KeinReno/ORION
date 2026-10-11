"use client";

import {
  useCreateNote,
  useDeleteNote,
  useNotes,
  usePreferences,
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
  Select,
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
  TriangleAlert,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { noteNumberLabel } from "@orion/shared-types";
import { ExtensionSlot, useSlotContributions } from "../lib/extensions/slot";
import { projectColor, relativeTime } from "../lib/format";
import { describeError } from "../lib/error-message";
import { FilterChip } from "../components/filter-chip";
import { useFocusedNoteId } from "../lib/panel-bus";
import { nextListId } from "../lib/list-nav";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { noteListPreview } from "../lib/note-list-preview";
import { NO_PROJECT, activeFilterCount, filterNotes } from "../lib/note-filters";
import { NoteEditor, contentTime, type NoteEditorInput } from "./note-editor";

type SortKey = "updated" | "created" | "title";

const NEW_NOTE = "__new__";
const TWO_PANE_MIN = 720;

export function NotesPanel(): React.ReactElement {
  const panelVisible = usePanelVisible();
  const { workspace } = useActiveWorkspace();
  const { isEnabled } = useEnabledModules();
  const projectsOn = isEnabled("projects");
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);
  const [view, setView] = useState<NoteView>("active");
  // «Шаблоны» is the notes-templates plugin's list: without it the template view is never on.
  const templatesApi = useSlotContributions("notes.templates")[0]?.meta;
  const [templatesViewRaw, setTemplatesView] = useState(false);
  const templatesView = templatesApi !== undefined && templatesViewRaw;
  const trash = view === "trash";
  const activeView = view === "active";
  const { data: notes, isLoading, isError, error, refetch } = useNotes(workspace?.id, debouncedQuery, view, templatesView);
  // Active projects of this workspace — the editor's "Проект" select and the
  // project chip in the list. Same source as TasksPanel.
  const { data: projectList } = useProjects(projectsOn ? workspace?.id : undefined);
  const showIds = usePreferences().data?.showNoteIds ?? false;
  const createNote = useCreateNote(workspace?.id);
  const updateNote = useUpdateNote(workspace?.id);
  const deleteNote = useDeleteNote(workspace?.id);
  const restoreNote = useRestoreNote(workspace?.id);
  const purgeNote = usePurgeNote(workspace?.id);
  const { toast } = useToast();

  const [wrapRef, width] = useResizeWidth<HTMLDivElement>();
  const twoPane = width >= TWO_PANE_MIN;

  const [sort, setSort] = useState<SortKey>("updated");
  const [groupByProject, setGroupByProject] = useState(false);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<"any" | "all">("any");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const [pendingDelete, setPendingDelete] = useState<Note | null>(null);
  const [pendingPurge, setPendingPurge] = useState<Note | null>(null);
  // Bumped after a revision restore to remount NoteEditor on the fresh note.
  const [editorReloadKey, setEditorReloadKey] = useState(0);

  // A project filter must not keep narrowing the list after Projects is turned off.
  useEffect(() => {
    if (!projectsOn) setProjectFilter(null);
  }, [projectsOn]);

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
    const filtered = filterNotes(notes ?? [], { tags: tagFilters, tagMode, projectId: projectFilter, pinnedOnly });
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
  }, [notes, tagFilters, tagMode, projectFilter, pinnedOnly, sort, trash, view]);

  // Grouping only changes the list presentation; records and saved sort remain untouched.
  // Stable Array#sort preserves the selected ordering within each project group.
  const groupingActive = groupByProject && !trash && projectsOn;
  const displayed = useMemo(() => {
    if (!groupingActive) return visible;
    const names = new Map((projectList ?? []).map((project) => [project.id, project.name]));
    const label = (note: Note): string => note.projectId ? names.get(note.projectId) ?? "Проект недоступен" : "Без проекта";
    return [...visible].sort((a, b) =>
      label(a).localeCompare(label(b), "ru") || (a.projectId ?? "").localeCompare(b.projectId ?? "")
    );
  }, [visible, groupingActive, projectList]);
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (groupingActive) for (const note of displayed) {
      const key = note.projectId ?? NO_PROJECT;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [displayed, groupingActive]);

  const filtersOn = activeFilterCount({ tags: tagFilters, tagMode, projectId: projectFilter, pinnedOnly });
  const projectName = (id: string): string => (projectList ?? []).find((p) => p.id === id)?.name ?? "проект";
  function resetFilters(): void {
    setTagFilters([]);
    setProjectFilter(null);
    setPinnedOnly(false);
  }

  const selected = selectedId && selectedId !== NEW_NOTE ? (notes ?? []).find((n) => n.id === selectedId) ?? null : null;
  const composing = selectedId === NEW_NOTE;

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!panelVisible || composing || pendingDelete || pendingPurge || tagManagerOpen) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const current = selectedIdRef.current && selectedIdRef.current !== NEW_NOTE ? selectedIdRef.current : null;
        const next = nextListId(displayed.map((note) => note.id), current, event.key === "ArrowDown" ? 1 : -1);
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
  }, [panelVisible, composing, pendingDelete, pendingPurge, tagManagerOpen, displayed, selectedId, trash]);

  async function handleCreate(input: NoteEditorInput): Promise<void> {
    const created = await createNote.mutateAsync({ ...input, isTemplate: templatesView });
    setSelectedId(created.id);
    toast({ title: templatesView ? "Шаблон создан" : "Заметка создана", tone: "success" });
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
            summary: (payload.current.summary as string | undefined) ?? "",
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
      summary: note.summary,
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

  const list = (
    <div className="orion-scroll flex-1 overflow-y-auto p-3">
      {!trash && (activeView || allTags.length > 0 || (projectList ?? []).length > 0) ? (
        <div className="mb-2 flex flex-wrap items-center gap-1 px-1">
          {activeView ? (
            <ExtensionSlot
              name="notes.filters"
              props={{ workspaceId: workspace?.id, active: templatesView, onToggle: () => setTemplatesView((v) => !v) }}
            />
          ) : null}
          {activeView ? (
            <FilterChip active={pinnedOnly} onClick={() => setPinnedOnly((v) => !v)}>
              Закреплённые
            </FilterChip>
          ) : null}
          {projectsOn && (projectList ?? []).length > 0 ? (
            <>
              <Select
                value={projectFilter ?? ""}
                onChange={(event) => setProjectFilter(event.target.value || null)}
                aria-label="Фильтр по проекту"
                className="w-auto min-w-[7.5rem] max-w-[11rem] rounded-full !py-1 !text-2xs"
              >
                <option value="">Все проекты</option>
                <option value={NO_PROJECT}>Без проекта</option>
                {(projectList ?? []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
              <FilterChip active={groupByProject} onClick={() => setGroupByProject((value) => !value)}>
                Группы по проектам
              </FilterChip>
            </>
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
      {filtersOn > 0 && !trash ? (
        <div className="mb-2 flex flex-wrap items-center gap-1 px-1 text-2xs text-subtle-foreground" aria-live="polite">
          <span>Показано {visible.length}{notes ? ` из ${notes.length}` : ""} ·</span>
          {pinnedOnly ? <ActiveFilter label="закреплённые" onClear={() => setPinnedOnly(false)} /> : null}
          {projectFilter !== null ? (
            <ActiveFilter
              label={projectFilter === NO_PROJECT ? "без проекта" : projectName(projectFilter)}
              onClear={() => setProjectFilter(null)}
            />
          ) : null}
          {tagFilters.map((tag) => (
            <ActiveFilter key={tag} label={`#${tag}`} onClear={() => toggleTagFilter(tag)} />
          ))}
          <button type="button" onClick={resetFilters} className="ml-1 text-accent-text hover:underline">
            Сбросить всё
          </button>
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
                  : query || filtersOn > 0
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
                  : query || filtersOn > 0
                    ? "Измените запрос или сбросьте фильтры, чтобы увидеть другие заметки."
                    : templatesView
                      ? "Создайте шаблон кнопкой сверху или отметьте существующую заметку как шаблон."
                      : "Создайте первую заметку кнопкой сверху."
            }
            action={
              query || filtersOn > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    resetFilters();
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
          {displayed.map((note, index) => {
            const active = note.id === selectedId;
            const project = note.projectId ? (projectList ?? []).find((p) => p.id === note.projectId) : undefined;
            const groupKey = note.projectId ?? NO_PROJECT;
            const startsGroup = groupingActive && (index === 0 || displayed[index - 1]?.projectId !== note.projectId);
            // The author's own description wins; otherwise a cleaned excerpt of the body.
            const preview = noteListPreview(note.summary.trim() || note.body);
            return (
              <li key={note.id}>
                {startsGroup ? (
                  <h3 className={cx("mb-1 flex items-center justify-between px-2 text-xs font-semibold text-muted-foreground", index > 0 ? "mt-4 border-t border-border/60 pt-3" : "mt-2")}>
                    <span className="truncate">{project?.name ?? (note.projectId ? "Проект недоступен" : "Без проекта")}</span>
                    <span className="ml-2 font-mono tabular-nums">{groupCounts.get(groupKey)}</span>
                  </h3>
                ) : null}
                <div
                  // The whole row is clickable for the mouse; keyboard and assistive tech use the
                  // button around the text below. The row itself must not be a button: it also
                  // holds the actions menu, and interactive controls cannot nest.
                  onClick={trash ? undefined : () => setSelectedId(note.id)}
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
                  <button
                    type="button"
                    disabled={trash}
                    aria-current={active ? "true" : undefined}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedId(note.id);
                    }}
                    className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-default"
                  >
                    <span className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                      {!trash && note.pinnedAt ? <Pin className="h-3 w-3 shrink-0 text-accent-text" /> : null}
                      {showIds && note.number !== null ? (
                        <span className="shrink-0 font-mono text-2xs font-normal text-subtle-foreground">{noteNumberLabel(note.number)}</span>
                      ) : null}
                      <span className="truncate">{note.title || "Без заголовка"}</span>
                    </span>
                    {preview ? (
                      <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{preview}</span>
                    ) : null}
                    <span className="mt-1 flex items-center gap-1.5 text-2xs text-subtle-foreground">
                      {project && !groupingActive ? (
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
                    </span>
                  </button>
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
                              ...(templatesApi
                                ? [{ label: templatesApi.toggleLabel(note), icon: FileStack, onSelect: () => handleToggleTemplate(note) }]
                                : []),
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
        onToggleTemplate={templatesApi ? handleToggleTemplate : undefined}
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
              <ExtensionSlot
                name="notes.header.actions"
                props={{
                  workspaceId: workspace?.id,
                  onOpenNote: (noteId) => {
                    setView("active");
                    setSelectedId(noteId);
                  }
                }}
              />
              <Button size="sm" onClick={() => setSelectedId(NEW_NOTE)}>
                <Plus className="h-4 w-4" /> {templatesView ? "Новый шаблон" : "Новая"}
              </Button>
              {!templatesView ? (
                <ExtensionSlot
                  name="notes.header.actions.end"
                  props={{
                    workspaceId: workspace?.id,
                    onOpenNote: (noteId) => {
                      setView("active");
                      setSelectedId(noteId);
                    }
                  }}
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
            placeholder={trash ? "В корзине поиск отключён" : "Название, описание, текст, теги, N-104"}
            aria-label="Поиск по заметкам"
            title="Ищет по названию, краткому описанию, тексту, тегам и короткому номеру (N-104)"
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

/** One removable active-filter pill: the way to see (and undo) exactly what narrows the list. */
function ActiveFilter({ label, onClear }: { label: string; onClear: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClear}
      aria-label={`Убрать фильтр: ${label}`}
      className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-accent-text hover:bg-accent/20"
    >
      {label}
      <X className="h-3 w-3" aria-hidden />
    </button>
  );
}
