"use client";

import {
  useCreateNote,
  useCreateNoteStack,
  useDeleteNote,
  useDeleteNoteStack,
  useMoveNotesToStack,
  useNotes,
  usePreferences,
  useProjects,
  usePurgeNote,
  useRestoreNote,
  useReorderNoteStack,
  useUpdateNote
} from "@orion/core-react";
import { TagManager } from "./tag-manager";
import type { Note, NoteView } from "@orion/shared-types";
import { AgentTouchSlot } from "../lib/agent-presence";
import { saveNoteWithRevision } from "../lib/note-save";
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
  Combobox,
  Skeleton,
  cx,
  isTypingTarget,
  useContextMenuApi,
  useDebouncedValue,
  usePanelVisible,
  useResizeWidth,
  useToast,
  type MenuItem
} from "@orion/ui";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ClipboardCopy,
  Copy,
  Download,
  ExternalLink,
  PanelRight,
  FileStack,
  FileText,
  Layers2,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useViewState } from "../lib/use-view-state";
import { notesViewStateSchema } from "@orion/shared-types";
import { noteNumberLabel } from "@orion/shared-types";
import { ExtensionSlot, useSlotContributions } from "../lib/extensions/slot";
import { projectColor, relativeTime } from "../lib/format";
import { describeError } from "../lib/error-message";
import { FilterChip } from "../components/filter-chip";
import { openPanel, useNoteFocusRequest } from "../lib/panel-bus";
import { ORION_PANEL_DRAG_MIME } from "../lib/panel-drop";
import { detachPanelToWindow } from "../lib/panel-window";
import { nextListId } from "../lib/list-nav";
import { ReplicaBanner } from "../components/replica-banner";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { copyNoteMarkdown, downloadNote } from "../lib/note-export";
import { noteListPreview } from "../lib/note-list-preview";
import { NO_PROJECT, activeFilterCount, filterNotes } from "../lib/note-filters";
import { NoteEditor, contentTime, type NoteEditorInput } from "./note-editor";
import { usePublishResourceContext } from "../lib/resource-context-store";

type SortKey = "updated" | "created" | "title";

const NEW_NOTE = "__new__";
const TWO_PANE_MIN = 720;

export function NotesPanel(): React.ReactElement {
  const panelVisible = usePanelVisible();
  const { workspace } = useActiveWorkspace();
  const { isEnabled } = useEnabledModules();
  const projectsOn = isEnabled("projects");
  // ORION-07: right-click on a row — same items as its "⋯" menu.
  const showContextMenu = useContextMenuApi();
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
  const createStack = useCreateNoteStack(workspace?.id);
  const reorderStack = useReorderNoteStack(workspace?.id);
  const deleteStack = useDeleteNoteStack(workspace?.id);
  const moveToStack = useMoveNotesToStack(workspace?.id);
  const updateNote = useUpdateNote(workspace?.id);
  const deleteNote = useDeleteNote(workspace?.id);
  const restoreNote = useRestoreNote(workspace?.id);
  const purgeNote = usePurgeNote(workspace?.id);
  const { toast } = useToast();

  const [wrapRef, width] = useResizeWidth<HTMLDivElement>();
  const twoPane = width >= TWO_PANE_MIN;

  const [sort, setSort] = useState<SortKey>("updated");
  const [listCollapsed, setListCollapsed] = useState(false);
  const [groupByProject, setGroupByProject] = useState(false);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<"any" | "all">("any");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const selectedSnapshotRef = useRef<Note | null>(null);
  const editorHasUnsavedChangesRef = useRef<(() => boolean) | null>(null);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const requestLeave = useCallback((action: () => void): void => {
    if (editorHasUnsavedChangesRef.current?.()) {
      setPendingLeave(() => action);
    } else {
      action();
    }
  }, []);
  const selectNote = useCallback((id: string | null): void => {
    if (selectedIdRef.current === id) return;
    requestLeave(() => {
      selectedIdRef.current = id;
      setSelectedId(id);
    });
  }, [requestLeave]);
  const [pendingDelete, setPendingDelete] = useState<Note | null>(null);
  const [pendingPurge, setPendingPurge] = useState<Note | null>(null);
  // Bumped after a revision restore to remount NoteEditor on the fresh note.
  const [editorReloadKey, setEditorReloadKey] = useState(0);
  const [stackSelection, setStackSelection] = useState<string[]>([]);
  const [stackTitleDraft, setStackTitleDraft] = useState("");
  const [expandedStacks, setExpandedStacks] = useState<Set<string>>(new Set());

  // A project filter must not keep narrowing the list after Projects is turned off.
  useEffect(() => {
    if (!projectsOn) setProjectFilter(null);
  }, [projectsOn]);

  // `noteFocusRequest` (not its id) in the deps: a fresh nonce on every focusNote() call is what lets
  // focusing the same note a second time in a row keep selecting it instead of silently no-oping.
  const noteFocusRequest = useNoteFocusRequest();
  useEffect(() => {
    if (!noteFocusRequest) return;
    requestLeave(() => {
      setView("active");
      setTemplatesView(false);
      setQuery("");
      setTagFilters([]);
      setProjectFilter(null);
      setPinnedOnly(false);
      setSelectedId(noteFocusRequest.id);
    });
  }, [noteFocusRequest, requestLeave]);

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
    let result = visible;
    if (groupingActive) {
      const names = new Map((projectList ?? []).map((project) => [project.id, project.name]));
      const label = (note: Note): string => note.projectId ? names.get(note.projectId) ?? "Проект недоступен" : "Без проекта";
      result = [...result].sort((a, b) => label(a).localeCompare(label(b), "ru") || (a.projectId ?? "").localeCompare(b.projectId ?? ""));
    }
    const members = new Map<string, Note[]>();
    for (const note of result) if (note.stackId) members.set(note.stackId, [...(members.get(note.stackId) ?? []), note]);
    for (const stack of members.values()) stack.sort((a, b) => (a.stackOrder ?? 0) - (b.stackOrder ?? 0));
    const emitted = new Map<string, number>();
    return result.map((note) => {
      if (!note.stackId) return note;
      const position = emitted.get(note.stackId) ?? 0;
      emitted.set(note.stackId, position + 1);
      return members.get(note.stackId)?.[position] ?? note;
    });
  }, [visible, groupingActive, projectList]);
  const renderedNotes = useMemo(() => displayed.filter((note, index) => {
    if (!note.stackId || expandedStacks.has(note.stackId)) return true;
    return displayed.findIndex((candidate) => candidate.stackId === note.stackId) === index;
  }), [displayed, expandedStacks]);
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (groupingActive) for (const note of displayed) {
      const key = note.projectId ?? NO_PROJECT;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [displayed, groupingActive]);
  const noteStacks = useMemo(() => {
    const map = new Map<string, { id: string; title: string; count: number }>();
    for (const note of notes ?? []) if (note.stackId) {
      const group = map.get(note.stackId);
      if (group) group.count += 1;
      else map.set(note.stackId, { id: note.stackId, title: note.stackTitle || "Стопка без названия", count: 1 });
    }
    return [...map.values()].sort((a, b) => a.title.localeCompare(b.title, "ru"));
  }, [notes]);

  const filtersOn = activeFilterCount({ tags: tagFilters, tagMode, projectId: projectFilter, pinnedOnly });
  const projectName = (id: string): string => (projectList ?? []).find((p) => p.id === id)?.name ?? "проект";
  function resetFilters(): void {
    setTagFilters([]);
    setProjectFilter(null);
    setPinnedOnly(false);
  }

  const matchedSelected = selectedId && selectedId !== NEW_NOTE ? (notes ?? []).find((n) => n.id === selectedId) ?? null : null;
  if (matchedSelected) selectedSnapshotRef.current = matchedSelected;
  // Server-side search can remove the currently open note from the list while
  // its editor still has unsaved text. Keep that editor mounted until the user
  // actually leaves it; never make a search result decide draft lifetime.
  const selected = matchedSelected ?? (selectedSnapshotRef.current?.id === selectedId ? selectedSnapshotRef.current : null);
  const composing = selectedId === NEW_NOTE;
  usePublishResourceContext(selected ? { type: "note", id: selected.id, title: selected.title } : null);
  const listHidden = twoPane && listCollapsed && (composing || selected !== null);
  // Narrow panel: the open note replaces the list, so the list's own controls step aside until "К заметкам".
  const editorOnly = !twoPane && !trash && (composing || selected !== null);
  const toolbarHidden = listHidden || editorOnly;

  // Filters, sort and the open note survive a restart (never the text or the search query). A restored
  // id is only an address: if the note is gone or not visible to this user, say so and open nothing.
  const restoredView = useViewState("notes", notesViewStateSchema, workspace?.id,
    { view, sort, groupByProject, tagFilters, tagMode, projectFilter, pinnedOnly, selectedId: selectedId === NEW_NOTE ? null : selectedId },
    (saved) => {
      setView(saved.view); setSort(saved.sort); setGroupByProject(projectsOn && saved.groupByProject); setTagFilters(saved.tagFilters);
      // The earlier "Projects is off" reset runs before this restore; normalize here so the saved filter cannot come back.
      setTagMode(saved.tagMode); setProjectFilter(projectsOn ? saved.projectFilter : null); setPinnedOnly(saved.pinnedOnly);
      if (saved.selectedId) { selectedIdRef.current = saved.selectedId; setSelectedId(saved.selectedId); }
    });
  const staleChecked = useRef(false);
  useEffect(() => {
    if (staleChecked.current || !restoredView || !notes || isLoading) return;
    staleChecked.current = true;
    if (restoredView.selectedId && !notes.some((n) => n.id === restoredView.selectedId)) {
      selectedIdRef.current = null; setSelectedId(null);
      toast({ title: "Прежняя заметка недоступна", description: "Она удалена, перемещена или у вас больше нет доступа." });
    }
  }, [restoredView, notes, isLoading, toast]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!panelVisible || composing || pendingDelete || pendingPurge || pendingLeave || tagManagerOpen) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const current = selectedIdRef.current && selectedIdRef.current !== NEW_NOTE ? selectedIdRef.current : null;
        const next = nextListId(displayed.map((note) => note.id), current, event.key === "ArrowDown" ? 1 : -1);
        if (next) {
          selectNote(next);
        }
        return;
      }
      if (event.key === "Enter" && selectedIdRef.current && selectedIdRef.current !== NEW_NOTE && !trash) {
        event.preventDefault();
        selectNote(selectedIdRef.current);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelVisible, composing, pendingDelete, pendingPurge, pendingLeave, tagManagerOpen, displayed, selectedId, trash, selectNote]);

  async function handleCreate(input: NoteEditorInput): Promise<void> {
    const created = await createNote.mutateAsync({ ...input, isTemplate: templatesView });
    selectedSnapshotRef.current = created;
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

  function handlePublish(note: Note): void {
    updateNote.mutate(
      { noteId: note.id, input: { isPrivate: false } },
      { onSuccess: () => toast({ title: "Заметка стала общей", description: "Теперь её видят все участники пространства.", tone: "success" }) }
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
    const updated = await saveNoteWithRevision(updateNote.mutateAsync, id, input, expectedRevision);
    if (!opts?.silent) toast({ title: "Сохранено", tone: "success" });
    return updated;
  }

  async function handleDuplicate(note: Note): Promise<void> {
    const created = await createNote.mutateAsync({
      title: `${note.title} (копия)`,
      summary: note.summary,
      body: note.body,
      tags: note.tags,
      isTemplate: note.isTemplate
    });
    selectedSnapshotRef.current = created;
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

  async function groupSelectedNotes(): Promise<void> {
    const title = stackTitleDraft.trim();
    if (!title || stackSelection.length < 2) return;
    try {
      await createStack.mutateAsync({ title, noteIds: stackSelection });
      setStackSelection([]);
      setStackTitleDraft("");
      toast({ title: "Стопка создана", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось создать стопку", description: describeError(error), tone: "danger" });
    }
  }

  function moveSelectionIntoStack(stackId: string): void {
    moveToStack.mutate({ stackId, noteIds: stackSelection }, {
      onSuccess: () => {
        setStackSelection([]);
        toast({ title: "Заметки перемещены", tone: "success" });
      },
      onError: (error) => toast({ title: "Не удалось переместить заметки", description: describeError(error), tone: "danger" })
    });
  }

  function shiftStackNote(note: Note, delta: -1 | 1): void {
    if (!note.stackId) return;
    if (query.trim()) {
      toast({ title: "Сбросьте поиск, чтобы изменить порядок всей стопки", tone: "default" });
      return;
    }
    const members = (notes ?? []).filter((item) => item.stackId === note.stackId).sort((a, b) => (a.stackOrder ?? 0) - (b.stackOrder ?? 0));
    const index = members.findIndex((item) => item.id === note.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= members.length) return;
    const reordered = [...members];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    reorderStack.mutate({ stackId: note.stackId, noteIds: reordered.map((item) => item.id) }, {
      onError: (error) => toast({ title: "Не удалось изменить порядок", description: describeError(error), tone: "danger" })
    });
  }

  function dissolveStack(note: Note): void {
    if (!note.stackId) return;
    deleteStack.mutate(note.stackId, {
      onSuccess: () => {
        setExpandedStacks((current) => new Set(current).add(note.stackId!));
        toast({ title: "Стопка удалена. Заметки сохранены.", tone: "success" });
      },
      onError: (error) => toast({ title: "Не удалось удалить стопку", description: describeError(error), tone: "danger" })
    });
  }

  const list = (
    <div className="orion-scroll flex-1 overflow-y-auto p-3">
      {!trash && (activeView || (projectList ?? []).length > 0) ? (
        <div className="mb-2 flex flex-wrap items-center gap-1 px-1">
          {activeView ? (
            <ExtensionSlot
              name="notes.filters"
              props={{ workspaceId: workspace?.id, active: templatesView, onToggle: () => requestLeave(() => {
                setTemplatesView((v) => !v);
                setSelectedId(null);
              }) }}
            />
          ) : null}
          {activeView ? (
            <FilterChip active={pinnedOnly} onClick={() => setPinnedOnly((v) => !v)}>
              Закреплённые
            </FilterChip>
          ) : null}
          {projectsOn && (projectList ?? []).length > 0 ? (
            <>
              <div className="w-44">
                <Combobox
                  label="Фильтр по проекту"
                  value={projectFilter ?? ""}
                  onChange={(id) => setProjectFilter(id || null)}
                  items={[
                    { id: "", label: "Все проекты" },
                    { id: NO_PROJECT, label: "Без проекта" },
                    ...(projectList ?? []).map((project) => ({ id: project.id, label: project.name }))
                  ]}
                />
              </div>
              <FilterChip active={groupByProject} onClick={() => setGroupByProject((value) => !value)}>
                Группы по проектам
              </FilterChip>
            </>
          ) : null}
        </div>
      ) : null}
      {!trash && allTags.length > 0 ? (
        <div className="mb-2 flex items-center gap-1 px-1">
          <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-x-auto py-0.5" role="group" aria-label="Фильтр по тегам">
            <FilterChip active={tagFilters.length === 0} onClick={() => setTagFilters([])}>
              Все
            </FilterChip>
            {allTags.map((tag) => (
              <FilterChip key={tag} active={tagFilters.includes(tag)} onClick={() => toggleTagFilter(tag)} color={tag}>
                {tag}
              </FilterChip>
            ))}
          </div>
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
        </div>
      ) : null}
      {!trash && !templatesView && stackSelection.length > 0 ? (
        <form
          className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/50 px-2 py-2"
          onSubmit={(event) => { event.preventDefault(); void groupSelectedNotes(); }}
        >
          <span className="text-xs text-subtle-foreground">Выбрано: {stackSelection.length}</span>
          <Input value={stackTitleDraft} onChange={(event) => setStackTitleDraft(event.target.value)} placeholder="Название стопки" aria-label="Название новой стопки" className="h-8 min-w-32 flex-1" />
          <Button size="sm" type="submit" disabled={stackSelection.length < 2 || !stackTitleDraft.trim() || createStack.isPending}>
            <Layers2 className="h-3.5 w-3.5" /> Объединить
          </Button>
          {noteStacks.length > 0 ? (
            <DropdownMenu
              trigger={({ toggle }) => (
                <Button size="sm" variant="outline" type="button" onClick={toggle} disabled={moveToStack.isPending}>
                  Переместить в стопку
                </Button>
              )}
              items={noteStacks.map((stack) => ({
                label: `${stack.title} · ${stack.count}`,
                icon: Layers2,
                onSelect: () => moveSelectionIntoStack(stack.id)
              }))}
            />
          ) : null}
          <Button size="sm" variant="subtle" type="button" onClick={() => setStackSelection([])}>Снять выбор</Button>
        </form>
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
          {renderedNotes.map((note, index) => {
            const active = note.id === selectedId;
            const project = note.projectId ? (projectList ?? []).find((p) => p.id === note.projectId) : undefined;
            const groupKey = note.projectId ?? NO_PROJECT;
            const startsGroup = groupingActive && (index === 0 || displayed[index - 1]?.projectId !== note.projectId);
            // The author's own description wins; otherwise a cleaned excerpt of the body.
            const preview = noteListPreview(note.summary.trim() || note.body);
            const noteMenuItems: (MenuItem | "separator")[] = trash
              ? [
                  { label: "Восстановить", icon: RotateCcw, onSelect: () => handleRestore(note) },
                  "separator",
                  { label: "Удалить навсегда", icon: Trash2, tone: "danger", onSelect: () => setPendingPurge(note) }
                ]
              : [
                  ...(note.stackId ? [
                    { label: "Выше в стопке", icon: ArrowUp, onSelect: () => shiftStackNote(note, -1) },
                    { label: "Ниже в стопке", icon: ArrowDown, onSelect: () => shiftStackNote(note, 1) },
                    { label: "Удалить стопку", icon: Layers2, onSelect: () => dissolveStack(note) },
                    "separator" as const
                  ] : []),
                  { label: note.pinnedAt ? "Открепить" : "Закрепить", icon: note.pinnedAt ? PinOff : Pin, onSelect: () => handleTogglePin(note) },
                  { label: note.archivedAt ? "Из архива" : "В архив", icon: note.archivedAt ? ArchiveRestore : Archive, onSelect: () => requestLeave(() => handleToggleArchive(note)) },
                  { label: "Открыть панелью", icon: PanelRight, onSelect: () => openPanel(`note:${note.id}`, note.title) },
                  { label: "Открыть окном", icon: ExternalLink, onSelect: () => void detachPanelToWindow(`note:${note.id}`, note.title) },
                  { label: "Дублировать", icon: Copy, onSelect: () => requestLeave(() => void handleDuplicate(note)) },
                  { label: "Скачать как .md", icon: Download, onSelect: () => downloadNote(note) },
                  {
                    label: "Копировать Markdown",
                    icon: ClipboardCopy,
                    onSelect: () =>
                      void copyNoteMarkdown(note).then(
                        () => toast({ title: "Скопировано", tone: "success" }),
                        () => toast({ title: "Не удалось скопировать", tone: "danger" })
                      )
                  },
                  ...(templatesApi ? [{ label: templatesApi.toggleLabel(note), icon: FileStack, onSelect: () => requestLeave(() => handleToggleTemplate(note)) }] : []),
                  "separator",
                  { label: "Удалить", icon: Trash2, tone: "danger", onSelect: () => requestLeave(() => setPendingDelete(note)) }
                ];
            const stackFirstIndex = note.stackId ? displayed.findIndex((item) => item.stackId === note.stackId) : -1;
            const stackMembers = note.stackId ? displayed.filter((item) => item.stackId === note.stackId) : [];
            const stackCollapsed = Boolean(note.stackId && !expandedStacks.has(note.stackId));
            return (
              <li key={note.id}>
                {startsGroup ? (
                  <h3 className={cx("mb-1 flex items-center justify-between px-2 text-xs font-semibold text-muted-foreground", index > 0 ? "mt-4 border-t border-border/60 pt-3" : "mt-2")}>
                    <span className="truncate">{project?.name ?? (note.projectId ? "Проект недоступен" : "Без проекта")}</span>
                    <span className="ml-2 font-mono tabular-nums">{groupCounts.get(groupKey)}</span>
                  </h3>
                ) : null}
                <AgentTouchSlot objectId={note.id}>
                {(mark) => (
                <div
                  // The whole row is clickable for the mouse; keyboard and assistive tech use the
                  // button around the text below. The row itself must not be a button: it also
                  // holds the actions menu, and interactive controls cannot nest.
                  onClick={trash ? undefined : () => selectNote(note.id)}
                  onContextMenu={(e) => showContextMenu(e, noteMenuItems)}
                  // Drag the note into the dock: it opens as a panel of its own, where it is dropped.
                  draggable={!trash}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(ORION_PANEL_DRAG_MIME, `note:${note.id}`);
                  }}
                  // Бросили за пределами окна приложения (другой монитор, рабочий стол) → заметка открывается отдельным окном там.
                  onDragEnd={(event) => {
                    const { clientX, clientY, screenX, screenY } = event;
                    const dropEffect = event.dataTransfer.dropEffect;
                    if (dropEffect !== "none" || (screenX === 0 && screenY === 0)) return;
                    const outside = clientX < 0 || clientY < 0 || clientX > window.innerWidth || clientY > window.innerHeight;
                    if (outside) void detachPanelToWindow(`note:${note.id}`, note.title, { x: screenX, y: screenY });
                  }}
                  className={cx(
                    "group relative flex items-start gap-2 rounded-xl border px-3 py-2.5 transition-colors",
                    stackCollapsed && stackFirstIndex === index ? "before:absolute before:inset-x-2 before:-bottom-1 before:-z-10 before:h-2 before:rounded-b-lg before:border before:border-border before:bg-card-hover after:absolute after:inset-x-4 after:-bottom-2 after:-z-20 after:h-2 after:rounded-b-lg after:border after:border-border/70 after:bg-card" : "",
                    mark.className,
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
                  {!trash && !templatesView ? (
                    <input
                      type="checkbox"
                      checked={stackSelection.includes(note.id)}
                      aria-label={`Выбрать заметку «${note.title}» для стопки`}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setStackSelection((current) => event.target.checked ? [...current, note.id] : current.filter((id) => id !== note.id))}
                      className="mt-1 h-3.5 w-3.5 shrink-0 accent-[hsl(var(--accent))]"
                    />
                  ) : null}
                  <button
                    type="button"
                    disabled={trash}
                    aria-current={active ? "true" : undefined}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectNote(note.id);
                    }}
                    className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-default"
                  >
                    <span className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                      {!trash && note.pinnedAt ? <Pin className="h-3 w-3 shrink-0 text-accent-text" /> : null}
                      {note.stackId && stackFirstIndex === index ? (
                        <span className="mr-0.5 inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0 text-2xs text-subtle-foreground">
                          <Layers2 className="h-3 w-3" />{note.stackTitle || "Стопка"} · {stackMembers.length}
                        </span>
                      ) : null}
                      {showIds && note.number !== null ? (
                        <span className="shrink-0 font-mono text-2xs font-normal text-subtle-foreground">{noteNumberLabel(note.number)}</span>
                      ) : null}
                      <span className="truncate">{note.title || "Без заголовка"}</span>
                      {mark.tag}
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
                  {note.stackId && stackFirstIndex === index ? (
                    <button
                      type="button"
                      aria-label={stackCollapsed ? `Раскрыть стопку «${note.stackTitle || "Без названия"}»` : "Свернуть стопку"}
                      title={stackCollapsed ? "Раскрыть стопку" : "Свернуть стопку"}
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpandedStacks((current) => {
                          const next = new Set(current);
                          if (next.has(note.stackId!)) next.delete(note.stackId!); else next.add(note.stackId!);
                          return next;
                        });
                      }}
                      className="mt-1 rounded px-1 text-2xs text-subtle-foreground hover:bg-card-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    >{stackCollapsed ? "Раскрыть" : "Свернуть"}</button>
                  ) : null}
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
                      items={noteMenuItems}
                    />
                  </div>
                </div>
                )}
                </AgentTouchSlot>
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
        compact={!twoPane}
        workspaceId={workspace?.id}
        projects={isEnabled("projects") ? (projectList ?? []) : undefined}
        busy={createNote.isPending}
        onCreate={handleCreate}
        onSave={handleSave}
        onClose={() => selectNote(null)}
        hasUnsavedChangesRef={editorHasUnsavedChangesRef}
        onReload={() => setEditorReloadKey((k) => k + 1)}
        onTogglePin={handleTogglePin}
        onToggleArchive={(note) => requestLeave(() => handleToggleArchive(note))}
        onDuplicate={(note) => requestLeave(() => void handleDuplicate(note))}
        onPublish={(note) => requestLeave(() => handlePublish(note))}
        onToggleTemplate={templatesApi ? (note) => requestLeave(() => handleToggleTemplate(note)) : undefined}
        onDelete={(note) => requestLeave(() => setPendingDelete(note))}
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
                    requestLeave(() => {
                      setView("active");
                      setSelectedId(noteId);
                    });
                  }
                }}
              />
              <Button size="sm" onClick={() => selectNote(NEW_NOTE)}>
                <Plus className="h-4 w-4" /> {templatesView ? "Новый шаблон" : "Новая"}
              </Button>
              {!templatesView ? (
                <ExtensionSlot
                  name="notes.header.actions.end"
                  props={{
                    workspaceId: workspace?.id,
                    onOpenNote: (noteId) => {
                      requestLeave(() => {
                        setView("active");
                        setSelectedId(noteId);
                      });
                    }
                  }}
                />
              ) : null}
            </div>
          )
        }
      >
        {twoPane && !trash && (composing || selected) ? (
          listHidden ? (
            <Button variant="subtle" size="sm" onClick={() => setListCollapsed(false)}>
              <PanelLeftOpen className="h-4 w-4" /> Список заметок
            </Button>
          ) : (
            <IconButton label="Скрыть список заметок" size="sm" onClick={() => setListCollapsed(true)}>
              <PanelLeftClose className="h-4 w-4" />
            </IconButton>
          )
        ) : null}
        {!toolbarHidden ? (
          <div className="relative w-full sm:w-auto sm:flex-1 sm:max-w-xs">
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
        ) : null}
        {activeView && !toolbarHidden ? (
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
        {!toolbarHidden ? (
          <SegmentedControl<NoteView>
            value={view}
            onChange={(next) => {
              requestLeave(() => {
                setView(next);
                setSelectedId(null);
              });
            }}
            size="sm"
            options={[
              { value: "active", label: "Активные" },
              { value: "archive", label: "Архив" },
              { value: "trash", label: "Корзина" }
            ]}
          />
        ) : null}
      </PanelHeader>
      <ReplicaBanner workspaceId={workspace?.id} />

      <div ref={wrapRef} className="flex min-h-0 flex-1">
        <div className={cx("min-w-0 flex-col", twoPane && !trash ? "w-[20rem] shrink-0 border-r border-border" : "flex-1",
          listHidden || (!twoPane && !trash && (composing || selected)) ? "hidden" : "flex")}>
          {list}
        </div>
        <div className={cx("min-h-0 min-w-0 flex-1", (trash || (!twoPane && !composing && !selected)) && "hidden")}>
          {editor}
        </div>
      </div>

      <ConfirmDialog
        open={pendingLeave !== null}
        title="Закрыть без сохранения?"
        description="Последние изменения заметки ещё не сохранены. При переходе они пропадут."
        confirmLabel="Не сохранять"
        danger
        onConfirm={() => {
          const action = pendingLeave;
          setPendingLeave(null);
          action?.();
        }}
        onCancel={() => setPendingLeave(null)}
      />
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
