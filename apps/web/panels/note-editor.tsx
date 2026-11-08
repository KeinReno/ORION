"use client";

import { useCaptureInboxItem, useCreateAndLink, usePublishObjectContext, useNoteBacklinks, useNoteTitles, usePreferences } from "@orion/core-react";
import { noteNumberLabel, type Note, type Project } from "@orion/shared-types";
import {
  AutosaveStatus,
  Button,
  DropdownMenu,
  IconButton,
  MarkdownEditor,
  MarkdownToolbar,
  MarkdownView,
  Popover,
  SegmentedControl,
  Combobox,
  TagsInput,
  EmptyScene,
  cx,
  useContextMenu,
  useContextMenuApi,
  useResizeWidth,
  markdownOutline,
  useToast,
  type FormatCommand,
  type MarkdownEditorApi,
  type MenuItem
} from "@orion/ui";
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Baseline,
  Bold,
  ClipboardCopy,
  Code,
  Copy,
  Download,
  FileStack,
  Lock,
  Unlock,
  Hash,
  History,
  Italic,
  Link2,
  List,
  ListChecks,
  EyeOff,
  Eye,
  ExternalLink,
  MoreHorizontal,
  PanelLeft as PanelLeftIcon,
  PanelRight,
  Pin,
  PinOff,
  SlidersHorizontal,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ComponentProps, type FormEvent, type MouseEvent, type MutableRefObject } from "react";
import { copyNoteMarkdown, downloadNote } from "../lib/note-export";
import { openPanel } from "../lib/panel-bus";
import { buildPanelDragId } from "../lib/panel-drag";
import { panelDragHandleProps } from "../lib/panel-drag-handle";
import { detachPanelToWindow } from "../lib/panel-window";
import { EntityLinksSection } from "../components/entity-links";
import { ShareGrantSection } from "../components/share-grant-section";
import { formatDayTitle, fromDatetimeLocal, projectColor, relativeTime, toDatetimeLocal } from "../lib/format";
import { describeError } from "../lib/error-message";
import { useUnsavedDraft } from "../lib/unsaved-drafts";
import { NoteAutosave, type AutosaveConflict, type AutosaveState as NoteAutosaveState } from "../lib/note-autosave";
import { openEntity } from "../lib/panel-bus";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { NoteAttachmentsSection } from "./note-attachments";
import { openInBrowser } from "../lib/panel-bus";
import { ExtensionSlot, useSlotContributions } from "../lib/extensions/slot";
import { isApplePlatform } from "../lib/mod-key";
import { useNotesToolbarPrefs } from "../lib/notes-toolbar-prefs";
import { describeCombo } from "../lib/shortcuts/combo";
import { useShortcutCombo, useShortcutCombos } from "../lib/shortcuts/registry";
import { taskFieldsFromSelection } from "../lib/convert-selection-to-task";

type EditorMode = "edit" | "preview";

/** editedAt is null for pre-v0.8 notes — fall back to updatedAt so the sort/label never breaks. */
export function contentTime(note: Note): string {
  return note.editedAt ?? note.updatedAt;
}

export interface NoteEditorInput {
  title: string;
  summary: string;
  body: string;
  tags: string[];
  eventAt: string | null;
  /** Real project (v0.14), same field the tasks module already uses. */
  projectId: string | null;
  /** Только при создании: личная заметка, видна лишь автору (ADR-0021). */
  isPrivate?: boolean;
}

/**
 * Note body + autosave — the second independent concern of NotesPanel
 * (list/search/filters stay in NotesPanel.tsx). Same split as
 * TasksPanel → task-card: the panel is layout, this file is the editor.
 */
export function NoteEditor({
  note,
  workspaceId,
  projects,
  busy,
  standalone,
  compact = false,
  onCreate,
  onSave,
  onClose,
  hasUnsavedChangesRef,
  onReload,
  onTogglePin,
  onToggleArchive,
  onDuplicate,
  onToggleTemplate,
  onPublish,
  onDelete
}: {
  note: Note | null;
  workspaceId: string | undefined;
  /** Active projects of this workspace — the "Проект" select. Absent = projects module is off. */
  projects?: Project[];
  busy: boolean;
  /** Already its own dock panel / window: no "open in a panel" actions. */
  standalone?: boolean;
  compact?: boolean;
  onCreate: (input: NoteEditorInput) => Promise<void>;
  /**
   * Throws an `AutosaveConflict` (see `../lib/note-autosave`) on a 409 CAS
   * mismatch — `NoteAutosave` catches that shape specifically to switch to
   * the "conflict" state instead of a generic retryable error.
   */
  onSave: (id: string, input: NoteEditorInput, expectedRevision: number, opts?: { silent?: boolean }) => Promise<Note>;
  onClose: () => void;
  /** Lets the panel guard list changes, Sheet dismissal and editor closure with one dialog. */
  hasUnsavedChangesRef?: MutableRefObject<(() => boolean) | null>;
  /** Ask the panel to remount this editor (e.g. after a revision restore replaced the content). */
  onReload: () => void;
  onTogglePin?: (note: Note) => void;
  onToggleArchive?: (note: Note) => void;
  onDuplicate?: (note: Note) => void;
  onToggleTemplate?: (note: Note) => void;
  /** Личная заметка становится общей (обратно нельзя — ADR-0021). */
  onPublish?: (note: Note) => void;
  onDelete?: (note: Note) => void;
}): React.ReactElement {
  const { toast } = useToast();
  const { isEnabled } = useEnabledModules();
  const calendarOn = isEnabled("calendar");
  const showIds = usePreferences().data?.showNoteIds ?? false;
  const { data: titles } = useNoteTitles(workspaceId);
  const { data: backlinks } = useNoteBacklinks(workspaceId, note?.id);
  const titleLookup = useMemo(() => new Map((titles ?? []).map((t) => [t.title.toLowerCase(), t])), [titles]);

  const [title, setTitle] = useState(note?.title ?? "");
  const [summary, setSummary] = useState(note?.summary ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [tags, setTags] = useState<string[]>(note?.tags ?? []);
  const [eventAt, setEventAt] = useState(toDatetimeLocal(note?.eventAt ?? null));
  const [projectId, setProjectId] = useState(note?.projectId ?? "");
  const [createPrivate, setCreatePrivate] = useState(false);
  const [mode, setMode] = useState<EditorMode>("edit");
  const [historyOpen, setHistoryOpen] = useState(false);
  // The history button exists only while a plugin fills `notes.history`.
  const historyButton = useSlotContributions("notes.history")[0]?.meta;
  const editorApi = useRef<MarkdownEditorApi | null>(null);
  const inspectorButtonId = useId();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [editorRef, editorWidth] = useResizeWidth<HTMLFormElement>();
  const wideInspector = editorWidth >= 1000;
  // A phone-width editor has no room for the word count beside the mode switch and the tools.
  const narrow = editorWidth > 0 && editorWidth < 420;

  // ORION-06 — the sticky formatting rail (AC1), the live rebind-aware combos it and the
  // CodeMirror keymap both read from, and "selection → task" (right-click on a selection + Mod-Alt-T).
  const toolbarPrefs = useNotesToolbarPrefs();
  const isMac = useMemo(() => isApplePlatform(), []);
  const formatCombos = useShortcutCombos([
    "notes.bold", "notes.italic", "notes.strike", "notes.code", "notes.link",
    "notes.h1", "notes.h2", "notes.h3", "notes.ordered", "notes.bullet", "notes.task", "notes.quote", "notes.codeblock"
  ] as const);
  const formatCombosByCommand: Partial<Record<FormatCommand, string>> = {
    bold: formatCombos["notes.bold"], italic: formatCombos["notes.italic"], strike: formatCombos["notes.strike"],
    code: formatCombos["notes.code"], link: formatCombos["notes.link"], h1: formatCombos["notes.h1"],
    h2: formatCombos["notes.h2"], h3: formatCombos["notes.h3"], ordered: formatCombos["notes.ordered"],
    bullet: formatCombos["notes.bullet"], task: formatCombos["notes.task"], quote: formatCombos["notes.quote"],
    codeblock: formatCombos["notes.codeblock"]
  };
  const shortcutLabels: Partial<Record<FormatCommand, string>> = Object.fromEntries(
    Object.entries(formatCombosByCommand).map(([command, combo]) => [command, describeCombo(combo, isMac)])
  );
  const convertToTaskCombo = useShortcutCombo("notes.convert-to-task");
  const createAndLink = useCreateAndLink(workspaceId);
  const captureInbox = useCaptureInboxItem(workspaceId);
  const showContextMenu = useContextMenuApi();

  async function convertSelectionToTask(selectedText: string): Promise<void> {
    if (!workspaceId) return;
    const { title, description } = taskFieldsFromSelection(selectedText);
    if (!title) return;
    try {
      if (note && note.projectId) {
        await createAndLink.mutateAsync({
          targetType: "note",
          targetId: note.id,
          kind: "related_to",
          entity: { type: "task", input: { title, description, priority: "normal", checklist: [], projectId: note.projectId } }
        });
        toast({ title: "Задача создана в проекте заметки", tone: "success" });
      } else {
        await captureInbox.mutateAsync({ title, body: description, kind: "inbox" });
        toast({ title: "Отправлено в Инбокс", tone: "success" });
      }
    } catch (error) {
      toast({ title: "Не удалось создать задачу", description: describeError(error), tone: "danger" });
    }
  }

  function onSelectionContextMenu(event: MouseEvent): void {
    if (mode !== "edit") return;
    const selected = editorApi.current?.selection();
    if (!selected || selected.text.trim() === "") return;
    const range = { from: selected.from, to: selected.to };
    const items: (MenuItem | "separator")[] = [
      { label: "Жирный", icon: Bold, onSelect: () => editorApi.current?.formatRange("bold", range) },
      { label: "Курсив", icon: Italic, onSelect: () => editorApi.current?.formatRange("italic", range) },
      { label: "Код в строке", icon: Code, onSelect: () => editorApi.current?.formatRange("code", range) },
      { label: "Ссылка", icon: Link2, onSelect: () => editorApi.current?.formatRange("link", range) },
      "separator",
      { label: "Выделенное — в задачу", icon: ListChecks, onSelect: () => void convertSelectionToTask(selected.text) },
      "separator",
      {
        label: "Копировать",
        icon: ClipboardCopy,
        onSelect: () => void navigator.clipboard.writeText(selected.text).catch(() => toast({ title: "Не удалось скопировать", tone: "danger" }))
      },
      {
        label: "Вырезать",
        onSelect: () =>
          void navigator.clipboard.writeText(selected.text).then(
            () => editorApi.current?.replaceRange(range, ""),
            () => toast({ title: "Не удалось вырезать", tone: "danger" })
          )
      },
      {
        label: "Вставить",
        onSelect: () =>
          void navigator.clipboard.readText().then(
            (clip) => editorApi.current?.replaceRange(range, clip),
            () => toast({ title: "Не удалось вставить", tone: "danger" })
          )
      }
    ];
    showContextMenu(event, items, { includeTypingTarget: true });
  }

  // S11: the compose form (note === null) always saves explicitly via the
  // Create button and never autosaves, so it keeps the old plain
  // "compare current fields to what was last saved" dirty check. An
  // existing note's dirty/saving/error/conflict state instead comes from
  // `NoteAutosave` (see below) — it's the only thing that knows whether the
  // *server* has acknowledged the latest content, which a local diff can't.
  const initial = useRef({
    title: note?.title ?? "",
    summary: note?.summary ?? "",
    body: note?.body ?? "",
    tags: note?.tags ?? [],
    eventAt: note?.eventAt ?? null,
    projectId: note?.projectId ?? null
  });
  const composeDirty =
    title !== initial.current.title ||
    summary !== initial.current.summary ||
    body !== initial.current.body ||
    eventAt !== toDatetimeLocal(initial.current.eventAt) ||
    (projectId || null) !== initial.current.projectId ||
    tags.length !== initial.current.tags.length ||
    tags.some((t, i) => t !== initial.current.tags[i]);

  const [autosaveState, setAutosaveState] = useState<NoteAutosaveState>("saved");
  const [conflict, setConflict] = useState<AutosaveConflict | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const autosaveRef = useRef<NoteAutosave | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // One NoteAutosave per open note (and its workspace) — a save started for
  // note A must never land on note B's UI state after the user switches, so
  // switching notes disposes the old controller (which drops any in-flight
  // result) and creates a fresh one seeded from the new note's own revision.
  // Component unmount hits the same `dispose()` via the cleanup function.
  useEffect(() => {
    if (!note || !workspaceId) {
      autosaveRef.current = null;
      return;
    }
    const controller = new NoteAutosave(
      { workspaceId, noteId: note.id },
      {
        debounceMs: 900,
        revision: note.revision,
        initial: { title: note.title, summary: note.summary, body: note.body, tags: note.tags, eventAt: note.eventAt, projectId: note.projectId },
        save: async (identity, snapshot, expectedRevision) => {
          const saved = await onSaveRef.current(
            identity.noteId,
            { title: snapshot.title, summary: snapshot.summary, body: snapshot.body, tags: snapshot.tags, eventAt: snapshot.eventAt, projectId: snapshot.projectId },
            expectedRevision,
            { silent: true }
          );
          return { revision: saved.revision };
        },
        onStateChange: setAutosaveState,
        onSaved: () => {
          setConflict(null);
          setSaveError(null);
        },
        onError: (err) => setSaveError(describeError(err)),
        onConflict: (c) => setConflict(c)
      }
    );
    autosaveRef.current = controller;
    return () => {
      controller.dispose();
      if (autosaveRef.current === controller) autosaveRef.current = null;
    };
    // Recreate only when the identity changes — not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id, workspaceId]);

  const dirty = note ? autosaveState !== "saved" || !title.trim() : composeDirty;
  const visibleSaveState = note && !title.trim() && autosaveState === "saved" ? "dirty" : autosaveState;
  usePublishObjectContext({ workspaceId: workspaceId ?? "", entityType: "note", entityId: note?.id ?? "compose",
    title: title || (note ? note.title : "Новая заметка"), saveState: note ? visibleSaveState : composeDirty ? "dirty" : "saved", hasPendingChanges: dirty, saveMode: note ? "autosave" : "explicit" });
  // Autosave can still be pending or fail. Switching workspaces must not dispose
  // its controller before the latest text has been acknowledged by the server.
  useUnsavedDraft(dirty);

  const words = useMemo(() => {
    const m = body.trim().match(/[^\s]+/g);
    return m ? m.length : 0;
  }, [body]);
  const readMin = Math.max(1, Math.round(words / 200));

  const outline = useMemo(() => markdownOutline(body), [body]);

  // Titles to offer in the `[[ ]]` autocomplete — everything except this note.
  const wikiTargets = useMemo(
    () => (titles ?? []).map((t) => t.title).filter((t) => t.toLowerCase() !== title.trim().toLowerCase()),
    [titles, title]
  );

  function navigateWikiLink(target: string): void {
    const match = (titles ?? []).find((t) => t.title.toLowerCase() === target.toLowerCase());
    if (match) openEntity("note", match.id);
    else toast({ title: `Заметки «${target}» нет`, tone: "default" });
  }

  // Feed every field change to the autosave controller — it owns its own
  // debounce, serialization (one in-flight save) and trailing drain (S11).
  // Skip while the title is blank: the server rejects that, and there's
  // nothing useful to save yet (matches the old guard in the removed
  // `runSave`). No effect for the compose form — `note` is null there.
  useEffect(() => {
    if (!note || !title.trim()) return;
    autosaveRef.current?.setSnapshot({ title, summary, body, tags, eventAt: fromDatetimeLocal(eventAt), projectId: projectId || null });
  }, [note, title, summary, body, tags, eventAt, projectId]);

  /** Explicit save (Submit button / Ctrl+S in the editor) — skips the debounce wait. */
  function runSave(): void {
    if (!note || !title.trim()) return;
    autosaveRef.current?.flush();
  }

  /** "Загрузить последнюю версию" in the conflict banner — discards local edits, adopts the server's. */
  function acceptServerVersion(): void {
    if (!conflict) return;
    setTitle(conflict.current.title);
    setSummary(conflict.current.summary);
    setBody(conflict.current.body);
    setTags(conflict.current.tags);
    setEventAt(toDatetimeLocal(conflict.current.eventAt));
    setProjectId(conflict.current.projectId ?? "");
    initial.current = { ...conflict.current };
    autosaveRef.current?.adoptServerState(conflict.current, conflict.currentRevision);
    setConflict(null);
  }

  /** "Сохранить мою версию" — keeps local edits, adopts the server's revision so the next save actually lands. */
  function overwriteServerVersion(): void {
    if (!conflict) return;
    autosaveRef.current?.forceRevision(conflict.currentRevision);
    setConflict(null);
    autosaveRef.current?.retry();
  }

  // Navigation guard (S11): warn on tab close / reload while there's
  // anything the server hasn't acknowledged yet (dirty, mid-save, or a
  // save that failed and is sitting as a local draft) — the one case an
  // in-app "Закрыть" confirm can't cover.
  useEffect(() => {
    if (!dirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent): void {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!hasUnsavedChangesRef) return;
    const check = () => dirty;
    hasUnsavedChangesRef.current = check;
    return () => {
      if (hasUnsavedChangesRef.current === check) hasUnsavedChangesRef.current = null;
    };
  }, [hasUnsavedChangesRef, dirty]);

  function requestClose(): void {
    // The list owns the existing discard confirmation. A standalone window has no list guard.
    if (standalone && dirty) {
      toast({ title: "Изменения ещё не сохранены", description: "Сохраните заметку или разрешите конфликт перед закрытием." });
      return;
    }
    onClose();
  }

  function jumpToHeading(slug: string): void {
    setMode("preview");
    // Wait for the preview to mount before scrolling to the anchor.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById(slug)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim()) return;
    if (note) {
      runSave();
    } else {
      await onCreate({ title, summary, body, tags, eventAt: fromDatetimeLocal(eventAt), projectId: projectId || null, ...(createPrivate ? { isPrivate: true } : {}) });
    }
  }

  const composing = note === null;
  const createDisabled = busy || !title.trim();
  const saving = autosaveState === "saving";

  const menuItems: ComponentProps<typeof DropdownMenu>["items"] = [];
  if (mode === "edit") {
    menuItems.push(
      {
        label: toolbarPrefs.side === "left" ? "Панель форматирования направо" : "Панель форматирования налево",
        icon: toolbarPrefs.side === "left" ? PanelRight : PanelLeftIcon,
        onSelect: () => toolbarPrefs.setSide(toolbarPrefs.side === "left" ? "right" : "left")
      },
      {
        label: toolbarPrefs.hidden ? "Показать панель форматирования" : "Скрыть панель форматирования",
        icon: toolbarPrefs.hidden ? Eye : EyeOff,
        onSelect: toolbarPrefs.toggleHidden
      }
    );
  }
  if (note) {
    if (menuItems.length > 0) menuItems.push("separator");
    if (!standalone) {
      menuItems.push(
        { label: "Открыть панелью", icon: PanelRight, onSelect: () => openPanel(`note:${note.id}`, note.title) },
        { label: "Открыть окном", icon: ExternalLink, onSelect: () => void detachPanelToWindow(`note:${note.id}`, note.title) }
      );
    }
    if (onTogglePin) {
      menuItems.push({
        label: note.pinnedAt ? "Открепить" : "Закрепить",
        icon: note.pinnedAt ? PinOff : Pin,
        onSelect: () => onTogglePin(note)
      });
    }
    if (onToggleArchive) {
      menuItems.push({
        label: note.archivedAt ? "Из архива" : "В архив",
        icon: note.archivedAt ? ArchiveRestore : Archive,
        onSelect: () => onToggleArchive(note)
      });
    }
    if (onDuplicate) {
      menuItems.push({ label: "Дублировать", icon: Copy, onSelect: () => onDuplicate(note) });
    }
    menuItems.push(
      { label: "Скачать как .md", icon: Download, onSelect: () => downloadNote(note) },
      {
        label: "Копировать Markdown",
        icon: ClipboardCopy,
        onSelect: () =>
          void copyNoteMarkdown(note).then(
            () => toast({ title: "Скопировано", tone: "success" }),
            () => toast({ title: "Не удалось скопировать", tone: "danger" })
          )
      }
    );
    if (note.isPrivate && onPublish) {
      menuItems.push({ label: "Сделать общей", icon: Unlock, onSelect: () => onPublish(note) });
    }
    if (onToggleTemplate) {
      menuItems.push({
        label: note.isTemplate ? "Убрать из шаблонов" : "Сделать шаблоном",
        icon: FileStack,
        onSelect: () => onToggleTemplate(note)
      });
    }
    if (onDelete) {
      menuItems.push("separator", { label: "Удалить", icon: Trash2, tone: "danger", onSelect: () => onDelete(note) });
    }
  }

  const editorContextMenu = useContextMenu(() => (note && menuItems.length > 0 ? menuItems : null));

  return (
    <form
      ref={editorRef}
      aria-label="Редактор заметки"
      onSubmit={submit}
      onContextMenu={editorContextMenu.onContextMenu}
      className="flex h-full min-h-0 min-w-0"
    >
      <div className={cx("min-h-0 min-w-0 flex-1 flex-col", inspectorOpen && !wideInspector ? "hidden" : "flex")}>
      {compact ? <div className="shrink-0 border-b border-border px-4 py-2"><Button type="button" size="sm" variant="ghost" onClick={requestClose}><ArrowLeft className="h-4 w-4" /> К заметкам</Button></div> : null}
      <div className="orion-scroll min-h-0 flex-1 overflow-y-auto p-4 sm:p-5 lg:px-8">
        <div className="mx-auto w-full max-w-[65ch] space-y-3">
          <div className="flex flex-wrap items-start gap-3">
            {/* Grows with the text: a one-line input cut a long title at the pane edge. A title is one line of
                meaning, so Enter does not add a line break and pasted breaks become spaces. */}
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value.replace(/\s*\n\s*/g, " "))}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault();
              }}
              rows={1}
              placeholder="Заголовок"
              aria-label="Название заметки"
              aria-invalid={note !== null && !title.trim()}
              required
              className="block min-w-[min(100%,14rem)] flex-1 resize-none overflow-hidden bg-transparent text-title text-foreground outline-none [field-sizing:content] placeholder:text-subtle-foreground"
            />
            <div className="flex min-w-0 flex-wrap items-center gap-2 pt-1">
              {autosaveState === "conflict" ? <span role="status" className="text-label text-warning">Конфликт версий</span> : <AutosaveStatus errorText="Не удалось сохранить — оставьте заметку открытой" state={visibleSaveState === "conflict" ? "error" : visibleSaveState} explicit={composing} />}
              {!composing && autosaveState === "error" ? (
                <Button
                  type="button"
                  variant="subtle"
                  size="sm"
                  onClick={() => autosaveRef.current?.retry()}
                  title={saveError ?? undefined}
                >
                  Повторить
                </Button>
              ) : null}
              {composing ? (
                <Button type="submit" variant="primary" size="sm" disabled={createDisabled} title={!title.trim() ? "Введите заголовок" : undefined}>
                  Создать
                </Button>
              ) : null}
              {menuItems.length > 0 ? (
                <DropdownMenu
                  align="end"
                  trigger={({ toggle }) => (
                    <IconButton label="Действия" size="sm" onClick={toggle}>
                      <MoreHorizontal className="h-4 w-4" />
                    </IconButton>
                  )}
                  items={menuItems}
                />
              ) : null}
            </div>
          </div>
          {note ? (
            <p
              className="flex flex-wrap items-center gap-x-1 text-micro text-subtle-foreground"
              {...(standalone ? {} : panelDragHandleProps(buildPanelDragId("note", note.id)))}
            >
              {showIds && note.number !== null ? (
                <button
                  type="button"
                  title="Скопировать короткий номер"
                  onClick={() => {
                    const label = noteNumberLabel(note.number) ?? "";
                    void navigator.clipboard?.writeText(label).then(
                      () => toast({ title: `${label} скопирован`, tone: "success" }),
                      () => undefined
                    );
                  }}
                  className="rounded border border-border px-1 font-mono text-subtle-foreground hover:text-foreground"
                >
                  {noteNumberLabel(note.number)}
                </button>
              ) : null}
              {note.dailyOn ? `Ежедневная · ${formatDayTitle(note.dailyOn)} · ` : ""}
              {note.isTemplate ? "Шаблон · " : ""}Создано {relativeTime(note.createdAt)} · изменено{" "}
              {relativeTime(contentTime(note))}
            </p>
          ) : null}

          {mode === "edit" ? (
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              maxLength={300}
              aria-label="Краткое описание"
              placeholder="Краткое описание — о чём заметка (необязательно)"
              className="w-full bg-transparent text-label text-muted-foreground outline-none placeholder:text-subtle-foreground"
            />
          ) : summary.trim() ? (
            <p className="text-label text-muted-foreground">{summary}</p>
          ) : null}

          {note && conflict ? (
            <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-label text-foreground">
              <p>
                Эту заметку сохранил кто-то другой (или вы сами в другой вкладке), пока вы её редактировали. Выберите,
                какую версию оставить — обе не сохранятся автоматически.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="subtle" size="sm" onClick={acceptServerVersion}>
                  Загрузить их версию
                </Button>
                <Button type="button" variant="primary" size="sm" onClick={overwriteServerVersion}>
                  Сохранить мою версию поверх
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-2 border-y border-border py-1.5">
            {/* Kept on one line: on a phone the switch used to wrap «Просмотр» under «Правка». */}
            <div className="shrink-0">
              <SegmentedControl<EditorMode>
                value={mode}
                onChange={setMode}
                size="sm"
                options={[
                  { value: "edit", label: "Правка" },
                  { value: "preview", label: "Просмотр" }
                ]}
              />
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              {words > 0 && !narrow ? (
                <span className="whitespace-nowrap text-micro text-subtle-foreground">
                  {words} сл · ~{readMin} мин
                </span>
              ) : null}
              {outline.length > 0 ? (
                <DropdownMenu
                  align="end"
                  trigger={({ toggle }) => (
                    <IconButton label="Оглавление" size="sm" onClick={toggle}>
                      <List className="h-4 w-4" />
                    </IconButton>
                  )}
                  items={outline.map((h) => ({
                    label: `${"  ".repeat(Math.max(0, h.level - 1))}${h.text || "—"}`,
                    icon: Hash,
                    onSelect: () => jumpToHeading(h.slug)
                  }))}
                />
              ) : null}
              <IconButton id={inspectorButtonId} aria-expanded={inspectorOpen} label="Свойства, связи и доступ" size="sm" onClick={() => setInspectorOpen(true)}>
                <SlidersHorizontal className="h-4 w-4" />
              </IconButton>
              {note && historyButton ? (
                <IconButton label={historyButton.buttonLabel} size="sm" onClick={() => setHistoryOpen(true)}>
                  <History className="h-4 w-4" />
                </IconButton>
              ) : null}
              {/* ORION-06: a pinned side rail has no room on a phone/narrow pane — the same tools live in this popover instead. */}
              {mode === "edit" && (narrow || compact) && !toolbarPrefs.hidden ? (
                <Popover
                  align="end"
                  trigger={({ toggle, ref }) => (
                    <span ref={ref as unknown as MutableRefObject<HTMLSpanElement>}>
                      <IconButton label="Форматирование" size="sm" onClick={toggle}>
                        <Baseline className="h-4 w-4" />
                      </IconButton>
                    </span>
                  )}
                >
                  {() => <div className="p-1"><MarkdownToolbar apiRef={editorApi} orientation="horizontal" shortcutLabels={shortcutLabels} /></div>}
                </Popover>
              ) : null}
            </div>
          </div>

          {mode === "edit" ? (
            <div className="flex items-start gap-2">
              {/* AC1: pinned beside the editor, inside the page's own scroll region — never scrolls out of view with a long note. */}
              {!narrow && !compact && !toolbarPrefs.hidden && toolbarPrefs.side === "left" ? (
                <div className="sticky top-2 shrink-0 self-start rounded-xl border border-border-strong bg-card/60 py-1">
                  <MarkdownToolbar apiRef={editorApi} shortcutLabels={shortcutLabels} />
                </div>
              ) : null}
              {/* Поле правки видно рамкой и фоном, а при фокусе подсвечивается;
                  в «Просмотре» рамки нет — там это уже не поле ввода. */}
              <div
                className="min-w-0 flex-1 space-y-2 rounded-xl border border-border-strong bg-card/60 px-3 py-2 transition-colors focus-within:border-accent/70 focus-within:ring-2 focus-within:ring-accent/25"
                onContextMenu={onSelectionContextMenu}
              >
                <MarkdownEditor
                  apiRef={editorApi}
                  value={body}
                  onChange={setBody}
                  onSave={() => void runSave()}
                  placeholder="Текст заметки… Markdown и [[ссылки]] поддерживаются"
                  className="min-h-[18rem]"
                  wikiLinkTargets={wikiTargets}
                  formatCombos={formatCombosByCommand}
                  convertToTaskCombo={convertToTaskCombo}
                  onConvertToTask={(text) => void convertSelectionToTask(text)}
                />
              </div>
              {!narrow && !compact && !toolbarPrefs.hidden && toolbarPrefs.side === "right" ? (
                <div className="sticky top-2 shrink-0 self-start rounded-xl border border-border-strong bg-card/60 py-1">
                  <MarkdownToolbar apiRef={editorApi} shortcutLabels={shortcutLabels} />
                </div>
              ) : null}
            </div>
          ) : body.trim() ? (
            <MarkdownView
              source={body}
              className="min-h-[18rem]"
              onWikiLink={navigateWikiLink}
              onExternalLink={openInBrowser}
              getWikiLinkPreview={(target) => titleLookup.get(target.toLowerCase())}
            />
          ) : (
            <EmptyScene title="Пусто" description="Переключитесь на «Правку», чтобы написать заметку." />
          )}
          <TagsInput label="Теги" value={tags} onChange={setTags} placeholder={tags.length === 0 ? "Новый тег" : "Ещё тег"} chipStyle={projectColor} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
        <span />
        <div className="flex gap-2">
          <Button type="button" variant="subtle" size="sm" onClick={requestClose}>
            Закрыть
          </Button>
          {composing ? (
            <Button type="submit" variant="primary" size="sm" disabled={createDisabled} title={!title.trim() ? "Введите заголовок" : undefined}>
              Создать
            </Button>
          ) : (
            <Button type="submit" size="sm" disabled={busy || saving || !title.trim() || !dirty}>
              Сохранить
            </Button>
          )}
        </div>
      </div>

      </div>
      {inspectorOpen ? <aside aria-label="Свойства заметки" onKeyDown={(event) => { if (event.key === "Escape" && event.currentTarget.contains(event.target as Node)) { event.preventDefault(); event.stopPropagation(); setInspectorOpen(false); requestAnimationFrame(() => document.getElementById(inspectorButtonId)?.focus()); } }} className={cx("flex min-h-0 min-w-0 flex-col border-l border-border bg-panel", wideInspector ? "w-80 shrink-0" : "flex-1")}>
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3"><h2 className="text-label font-medium">Свойства заметки</h2><IconButton autoFocus label="Вернуться к тексту заметки" size="sm" onClick={() => { setInspectorOpen(false); requestAnimationFrame(() => document.getElementById(inspectorButtonId)?.focus()); }}><X className="h-4 w-4" /></IconButton></header>
        <div className="orion-scroll min-h-0 flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          {calendarOn ? (
            <label className="flex flex-col gap-1.5 text-label text-subtle-foreground">
              Показать в календаре
              <input
                type="datetime-local"
                value={eventAt}
                onChange={(e) => setEventAt(e.target.value)}
                className="rounded-md border border-border bg-transparent px-2 py-1 text-foreground outline-none focus:border-accent"
              />
              {eventAt ? (
                <button type="button" onClick={() => setEventAt("")} className="text-subtle-foreground hover:text-foreground">
                  Убрать
                </button>
              ) : null}
            </label>
          ) : null}
          {note === null ? (
            <label className="flex items-center gap-2 text-label text-subtle-foreground">
              <input type="checkbox" checked={createPrivate} onChange={(e) => setCreatePrivate(e.target.checked)} />
              Личная — видна только вам
            </label>
          ) : note.isPrivate ? (
            <p className="flex items-center gap-1.5 text-label text-subtle-foreground">
              <Lock className="h-3.5 w-3.5" aria-hidden /> Личная заметка: её видите только вы
            </p>
          ) : null}
          {projects ? (
            <Combobox
              label="Проект"
              value={projectId}
              onChange={setProjectId}
              items={[{ id: "", label: "Без проекта" }, ...projects.map((project) => ({ id: project.id, label: project.name }))]}
            />
          ) : null}

          {note ? (
            <div className="border-t border-border pt-3">
              <EntityLinksSection workspaceId={workspaceId} type="note" id={note.id} />
            </div>
          ) : null}

          {note ? (
            <div className="border-t border-border pt-3">
              <ShareGrantSection workspaceId={workspaceId} type="note" id={note.id} />
            </div>
          ) : null}

          {note ? (
            <div className="border-t border-border pt-3">
              <NoteAttachmentsSection workspaceId={workspaceId} noteId={note.id} />
            </div>
          ) : null}

          {note && backlinks && backlinks.length > 0 ? (
            <div className="space-y-1.5 border-t border-border pt-3">
              <p className="flex items-center gap-1.5 text-micro font-medium text-subtle-foreground">
                <Link2 className="h-3 w-3" /> Упоминания · {backlinks.length}
              </p>
              <ul className="space-y-1">
                {backlinks.map((bl) => (
                  <li key={bl.id}>
                    <button
                      type="button"
                      onClick={() => openEntity("note", bl.id)}
                      className="w-full rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-card-hover"
                    >
                      <span className="block truncate text-label font-medium text-foreground">{bl.title || "Без заголовка"}</span>
                      {bl.snippet ? (
                        <span className="mt-0.5 block truncate text-micro text-subtle-foreground">{bl.snippet}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        </div>
      </aside> : null}

      {note ? (
        <ExtensionSlot
          name="notes.history"
          props={{
            workspaceId,
            noteId: note.id,
            currentTitle: title,
            currentBody: body,
            open: historyOpen,
            onClose: () => setHistoryOpen(false),
            onRestored: () => {
              setHistoryOpen(false);
              onReload();
            }
          }}
        />
      ) : null}
    </form>
  );
}
