"use client";

import { usePublishObjectContext, useNoteBacklinks, useNoteTitles, usePreferences } from "@orion/core-react";
import { noteNumberLabel, type Note, type Project } from "@orion/shared-types";
import {
  AutosaveStatus,
  Button,
  DropdownMenu,
  IconButton,
  MarkdownEditor,
  MarkdownToolbar,
  MarkdownView,
  SegmentedControl,
  Select,
  cx,
  useResizeWidth,
  markdownOutline,
  useToast,
  type MarkdownEditorApi
} from "@orion/ui";
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  ClipboardCopy,
  Copy,
  Download,
  FileStack,
  Hash,
  History,
  Link2,
  List,
  ExternalLink,
  MoreHorizontal,
  PanelRight,
  Pin,
  PinOff,
  SlidersHorizontal,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ComponentProps, type FormEvent, type MutableRefObject } from "react";
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
  const [tagDraft, setTagDraft] = useState("");
  const [eventAt, setEventAt] = useState(toDatetimeLocal(note?.eventAt ?? null));
  const [projectId, setProjectId] = useState(note?.projectId ?? "");
  const [mode, setMode] = useState<EditorMode>("edit");
  const [historyOpen, setHistoryOpen] = useState(false);
  // The history button exists only while a plugin fills `notes.history`.
  const historyButton = useSlotContributions("notes.history")[0]?.meta;
  const editorApi = useRef<MarkdownEditorApi | null>(null);
  const inspectorButtonId = useId();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [editorRef, editorWidth] = useResizeWidth<HTMLFormElement>();
  const wideInspector = editorWidth >= 1000;
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

  function addTag(raw: string): void {
    const tag = raw.trim();
    if (!tag || tags.includes(tag)) return;
    setTags((cur) => [...cur, tag]);
    setTagDraft("");
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
      await onCreate({ title, summary, body, tags, eventAt: fromDatetimeLocal(eventAt), projectId: projectId || null });
    }
  }

  const composing = note === null;
  const createDisabled = busy || !title.trim();
  const saving = autosaveState === "saving";

  const menuItems: ComponentProps<typeof DropdownMenu>["items"] = [];
  if (note) {
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

  return (
    <form ref={editorRef} aria-label="Редактор заметки" onSubmit={submit} className="flex h-full min-h-0 min-w-0">
      <div className={cx("min-h-0 min-w-0 flex-1 flex-col", inspectorOpen && !wideInspector ? "hidden" : "flex")}>
      {compact ? <div className="shrink-0 border-b border-border px-4 py-2"><Button type="button" size="sm" variant="ghost" onClick={requestClose}><ArrowLeft className="h-4 w-4" /> К заметкам</Button></div> : null}
      <div className="orion-scroll min-h-0 flex-1 overflow-y-auto p-4 sm:p-5 lg:px-8">
        <div className="mx-auto w-full max-w-[65ch] space-y-3">
          <div className="flex flex-wrap items-start gap-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Заголовок"
              aria-label="Название заметки"
              aria-invalid={note !== null && !title.trim()}
              required
              className="min-w-[min(100%,14rem)] flex-1 bg-transparent text-title text-foreground outline-none placeholder:text-subtle-foreground"
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
              {note && menuItems.length > 0 ? (
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
            <SegmentedControl<EditorMode>
              value={mode}
              onChange={setMode}
              size="sm"
              options={[
                { value: "edit", label: "Правка" },
                { value: "preview", label: "Просмотр" }
              ]}
            />
            <div className="flex items-center gap-1.5">
              {words > 0 ? (
                <span className="text-micro text-subtle-foreground">
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
            </div>
          </div>

          {mode === "edit" ? (
            // Поле правки видно рамкой и фоном, а при фокусе подсвечивается;
            // в «Просмотре» рамки нет — там это уже не поле ввода.
            <div className="space-y-2 rounded-xl border border-border-strong bg-card/60 px-3 py-2 transition-colors focus-within:border-accent/70 focus-within:ring-2 focus-within:ring-accent/25">
              <MarkdownToolbar apiRef={editorApi} />
              <MarkdownEditor
                apiRef={editorApi}
                value={body}
                onChange={setBody}
                onSave={() => void runSave()}
                placeholder="Текст заметки… Markdown и [[ссылки]] поддерживаются"
                className="min-h-[18rem]"
                wikiLinkTargets={wikiTargets}
              />
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
            <p className="min-h-[18rem] text-body text-subtle-foreground">Пусто — переключитесь на «Правку».</p>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                style={projectColor(tag)}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-medium"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => setTags((cur) => cur.filter((x) => x !== tag))}
                  aria-label={`Убрать тег ${tag}`}
                  className="opacity-60 hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag(tagDraft);
                } else if (e.key === "Backspace" && !tagDraft && tags.length > 0) {
                  setTags((cur) => cur.slice(0, -1));
                }
              }}
              onBlur={() => addTag(tagDraft)}
              placeholder={tags.length === 0 ? "Новый тег" : "Ещё тег"}
              className="min-w-[6rem] flex-1 bg-transparent text-micro text-foreground outline-none placeholder:text-subtle-foreground"
            />
          </div>
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
          {projects ? (
            <label className="flex flex-col gap-1.5 text-label text-subtle-foreground">
              Проект
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Без проекта</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </label>
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
