"use client";

import { useCaptureInboxItem, useCreateNote, useCreateTask, useGlobalSearch, useNotes, useTasks } from "@orion/core-react";
import { isModuleEnabled, localDayDueAt, quickCapturePlaceholder, resolveQuickCapture } from "@orion/shared-types";
import { Input, Kbd, Modal, isTypingTarget, useDebouncedValue, useHotkey, useToast } from "@orion/ui";
import {
  CalendarDays,
  CornerDownLeft,
  FileText,
  FolderKanban,
  Inbox,
  ListChecks,
  ListTodo,
  Plus,
  Receipt,
  Settings,
  StickyNote,
  UserRound,
  type LucideIcon
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useCaptureToList } from "./capture-to-list";
import { openEntity, openList, openPanel, openSettings } from "./panel-bus";
import { groupPaletteResults, selectPaletteResults, type PaletteEntry } from "./palette-results";
import { isPanelAvailable, panelRegistry } from "./panel-registry";
import { SETTINGS_FIELDS, settingsScopeText, settingsTabInfo } from "./settings-catalog";
import { relativeTime, shortDate } from "./format";
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL } from "./task-labels";
import type { ViewRef } from "@orion/shared-types";
import { ObjectOpenMenu } from "../components/object-open-menu";
import { useActiveWorkspace } from "./use-active-workspace";
import { useEnabledModules } from "./use-enabled-modules";

/** The shell button and keyboard shortcut open the same command surface. */
export function showCommandPalette(): void { window.dispatchEvent(new Event("orion:open-command-palette")); }

interface Command extends PaletteEntry {
  view?: ViewRef;
  hint?: string;
  icon: LucideIcon;
  run: () => void;
}

/** Which panel a search hit of each type opens. */
const PANEL_FOR_TYPE: Record<string, string> = {
  project: "projects",
  task: "tasks",
  note: "notes",
  event: "calendar",
  document: "documents",
  transaction: "finance",
  contact: "contacts",
  list: "lists"
};

/** Icon + panel for a server-side search hit, by entity type (`GlobalSearchResult.type`). */
const SEARCH_RESULT_ICONS: Record<string, LucideIcon> = {
  project: FolderKanban,
  task: ListTodo,
  note: StickyNote,
  event: CalendarDays,
  document: FileText,
  transaction: Receipt,
  contact: UserRound,
  list: ListChecks
};
/** Group heading of a server-side search hit, by entity type. */
const SEARCH_RESULT_GROUPS: Record<string, string> = {
  project: "Проекты",
  task: "Задачи",
  note: "Заметки",
  event: "События",
  document: "Документы",
  transaction: "Операции",
  contact: "Контакты",
  list: "Списки"
};

/** Which group a palette entry is listed under; derived from the id prefix every builder already uses. */
function paletteGroupOf(entry: PaletteEntry): string {
  const [prefix, type] = entry.id.split(":");
  if (prefix === "a") return "Действия";
  if (prefix === "p") return "Разделы";
  if (prefix === "c") return "Настройки";
  if (prefix === "t") return "Задачи";
  if (prefix === "n") return "Заметки";
  if (prefix === "s") return SEARCH_RESULT_GROUPS[type ?? ""] ?? "Найдено";
  return "Другое";
}

interface PalettePreview {
  kind: string;
  title: string;
  meta: string[];
  body?: string;
}

const excerpt = (text: string, max = 280): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const SEARCH_RESULT_LABELS: Record<string, string> = {
  project: "проект",
  task: "задача",
  note: "заметка",
  event: "событие",
  document: "документ",
  transaction: "операция",
  contact: "контакт",
  list: "список"
};

/** Second key after G. Letters avoid colliding with bare N (capture). */
const GOTO_PANELS: { key: string; panelId: string; label: string }[] = [
  { key: "d", panelId: "dashboard", label: "Дашборд" },
  { key: "i", panelId: "inbox", label: "Инбокс" },
  { key: "t", panelId: "tasks", label: "Задачи" },
  { key: "c", panelId: "calendar", label: "Календарь" },
  { key: "n", panelId: "notes", label: "Заметки" },
  { key: "p", panelId: "projects", label: "Проекты" },
  { key: "w", panelId: "time", label: "Время" },
  { key: "h", panelId: "habits", label: "Привычки" },
  { key: "l", panelId: "lists", label: "Списки" },
  { key: "f", panelId: "finance", label: "Финансы" },
  { key: "k", panelId: "inventory", label: "Склад" },
  { key: "m", panelId: "markets", label: "Рынки" },
  { key: "b", panelId: "browser", label: "Браузер" },
  { key: "o", panelId: "documents", label: "Документы" },
  { key: "y", panelId: "sync", label: "Резервные копии" },
  { key: "s", panelId: "settings", label: "Настройки" }
];

/**
 * App-wide keyboard surfaces, mounted once in the (app) layout:
 *  - ⌘K / Ctrl+K — command palette (jump to a panel, note or task, plus
 *    server-side search across every module once the query is ≥2 chars).
 *  - N or ⌘⇧N / Ctrl+Shift+N — quick capture (thought → inbox; `/task` / `/note` shortcuts).
 *  - G then a letter — jump to a panel (G D dashboard, G T tasks, G N notes).
 * All talk to the Workbench through panel-bus, so none import dockview.
 */
export function CommandCenter(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const { isEnabled, disabledModules } = useEnabledModules();
  const { data: notes } = useNotes(isEnabled("notes") ? workspace?.id : undefined);
  const { data: tasks } = useTasks(isEnabled("tasks") ? workspace?.id : undefined);
  const createNote = useCreateNote(isEnabled("notes") ? workspace?.id : undefined);
  const createTask = useCreateTask(isEnabled("tasks") ? workspace?.id : undefined);
  const captureInbox = useCaptureInboxItem(workspace?.id);
  const captureToList = useCaptureToList(workspace?.id);
  const { toast } = useToast();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [capture, setCapture] = useState("");
  const [capturePrefill, setCapturePrefill] = useState("");
  useEffect(() => {
    const open = (): void => setPaletteOpen(true);
    window.addEventListener("orion:open-command-palette", open);
    return () => window.removeEventListener("orion:open-command-palette", open);
  }, []);
  const [gotoArmed, setGotoArmed] = useState(false);
  const gotoArmedRef = useRef(false);

  // The palette is the only place that needs the debounce: the local command
  // list filters instantly, the server query waits for a pause in typing.
  const debouncedQuery = useDebouncedValue(query, 250);
  const { data: searchHits, isFetching: searchPending } = useGlobalSearch(workspace?.id, debouncedQuery);

  useHotkey(
    "mod+k",
    (e) => {
      e.preventDefault();
      setPaletteOpen((v) => !v);
    },
    true
  );
  useHotkey(
    "mod+shift+n",
    (e) => {
      e.preventDefault();
      setCapturePrefill("");
      setCaptureOpen(true);
    },
    true
  );

  useEffect(() => {
    let timer = 0;
    function arm(): void {
      gotoArmedRef.current = true;
      setGotoArmed(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        gotoArmedRef.current = false;
        setGotoArmed(false);
      }, 1600);
    }
    function disarm(): void {
      gotoArmedRef.current = false;
      setGotoArmed(false);
      window.clearTimeout(timer);
    }
    function onKey(event: KeyboardEvent): void {
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (paletteOpen || captureOpen) return;
      if (gotoArmedRef.current) {
        if (event.key === "Escape") {
          event.preventDefault();
          disarm();
          return;
        }
        const letter = event.key.toLowerCase();
        if (letter.length !== 1 || letter < "a" || letter > "z") return;
        event.preventDefault();
        event.stopPropagation();
        disarm();
        const target = GOTO_PANELS.find((item) => item.key === letter);
        if (!target) return;
        const panel = panelRegistry.find((item) => item.id === target.panelId);
        if (panel?.moduleId && !isModuleEnabled(disabledModules, panel.moduleId)) {
          toast({ title: `«${target.label}» выключен` });
          return;
        }
        openPanel(target.panelId);
        return;
      }
      if (event.key === "g" || event.key === "G") {
        event.preventDefault();
        arm();
        return;
      }
      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        setCapturePrefill("");
        setCaptureOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
    };
  }, [paletteOpen, captureOpen, disabledModules, toast]);

  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [paletteOpen]);
  useEffect(() => {
    if (captureOpen) setCapture(capturePrefill);
  }, [captureOpen, capturePrefill]);

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      {
        id: "a:inbox",
        label: "В инбокс",
        hint: "действие",
        icon: Inbox,
        run: () => {
          setCapturePrefill("");
          setCaptureOpen(true);
        }
      },
      {
        id: "a:process-inbox",
        label: "Разобрать инбокс",
        hint: "действие",
        icon: Inbox,
        run: () => openPanel("inbox")
      }
    ];
    if (isEnabled("tasks")) {
      base.push({
        id: "a:new-task",
        label: "Новая задача",
        hint: "действие",
        icon: Plus,
        run: () => {
          setCapturePrefill("/task ");
          setCaptureOpen(true);
        }
      });
    }
    if (isEnabled("notes")) {
      base.push({
        id: "a:new-note",
        label: "Новая заметка",
        hint: "действие",
        icon: Plus,
        run: () => {
          setCapturePrefill("/note ");
          setCaptureOpen(true);
        }
      });
    }
    for (const panel of panelRegistry) {
      if (panel.instanced) continue; // opened per record (e.g. a project), not as a bare panel
      if (!isPanelAvailable(panel, disabledModules, workspace?.pluginOverrides)) continue;
      base.push({
        id: `p:${panel.id}`,
        label: panel.label,
        hint: "панель",
        icon: panel.icon,
        run: () => openPanel(panel.id)
      });
    }
    // Every settings parameter, so «тихие часы» lands on the field itself, not on the settings panel.
    for (const field of SETTINGS_FIELDS) {
      base.push({
        id: `c:${field.tab}:${field.anchor}`,
        label: field.label,
        hint: `настройки · ${settingsTabInfo(field.tab)?.label ?? field.tab}`,
        icon: Settings,
        run: () => openSettings(field.tab, field.anchor)
      });
    }
    if (isEnabled("tasks")) {
      for (const task of tasks ?? []) {
        base.push({
          id: `t:${task.id}`,
          label: task.title,
          hint: "задача",
          icon: ListTodo,
          entityKey: `task:${task.id}`,
          run: () => openEntity("task", task.id, task.title),
          view: { object: { workspaceId: workspace?.id ?? "", entityType: "task", entityId: task.id }, viewId: "detail" }
        });
      }
    }
    if (isEnabled("notes")) {
      for (const note of notes ?? []) {
        base.push({
          id: `n:${note.id}`,
          label: note.title || "Без заголовка",
          hint: "заметка",
          icon: StickyNote,
          entityKey: `note:${note.id}`,
          run: () => openEntity("note", note.id, note.title),
          view: { object: { workspaceId: workspace?.id ?? "", entityType: "note", entityId: note.id }, viewId: "detail" }
        });
      }
    }
    for (const hit of searchHits ?? []) {
      const moduleId = PANEL_FOR_TYPE[hit.type];
      const panel = panelRegistry.find((item) => item.id === moduleId);
      if (panel?.moduleId && !isModuleEnabled(disabledModules, panel.moduleId)) continue;
      base.push({
        id: `s:${hit.type}:${hit.id}`,
        label: hit.title || "Без названия",
        hint: SEARCH_RESULT_LABELS[hit.type] ?? hit.type,
        icon: SEARCH_RESULT_ICONS[hit.type] ?? FileText,
        serverResult: true,
        entityKey: `${hit.type}:${hit.id}`,
        resultGroup: hit.type,
        run: () => openEntity(hit.type, hit.id, hit.title),
        view: { object: { workspaceId: workspace?.id ?? "", entityType: hit.type, entityId: hit.id }, viewId: "detail" }
      });
    }
    return base;
  }, [tasks, notes, searchHits, disabledModules, isEnabled, workspace?.id, workspace?.pluginOverrides]);

  const results = useMemo(() => {
    return selectPaletteResults(commands, query, debouncedQuery);
  }, [commands, query, debouncedQuery]);
  // Grouped for display; `ordered` is what ↑/↓ and Enter walk, so the keyboard follows the groups.
  const { groups, ordered } = useMemo(() => groupPaletteResults(results, paletteGroupOf), [results]);
  const activeEntry = ordered[activeIndex];

  /** What the right-hand pane says about the highlighted entry — read from data already loaded, no extra request. */
  function previewOf(entry: Command | undefined): PalettePreview | null {
    if (!entry) return null;
    const [prefix, a, b] = entry.id.split(":");
    if (prefix === "t") {
      const task = tasks?.find((item) => item.id === a);
      if (!task) return null;
      return {
        kind: "Задача",
        title: task.title,
        meta: [
          TASK_STATUS_LABEL[task.status],
          task.dueAt ? `срок ${shortDate(task.dueAt)}` : "без срока",
          ...(task.priority !== "normal" ? [`приоритет: ${TASK_PRIORITY_LABEL[task.priority].toLowerCase()}`] : [])
        ],
        body: task.description ? excerpt(task.description) : undefined
      };
    }
    if (prefix === "n") {
      const note = notes?.find((item) => item.id === a);
      if (!note) return null;
      return {
        kind: "Заметка",
        title: note.title || "Без заголовка",
        meta: [`изменена ${relativeTime(note.updatedAt)}`, ...note.tags.slice(0, 4).map((tag) => `#${tag}`)],
        body: note.body ? excerpt(note.body) : "Пустая заметка"
      };
    }
    if (prefix === "s") {
      const hit = searchHits?.find((item) => item.type === a && item.id === b);
      if (!hit) return null;
      return {
        kind: (SEARCH_RESULT_LABELS[hit.type] ?? hit.type).replace(/^./, (letter) => letter.toUpperCase()),
        title: hit.title || "Без названия",
        meta: [hit.subtitle, `изменено ${relativeTime(hit.updatedAt)}`].filter(Boolean),
        body: hit.matchedText ? excerpt(hit.matchedText) : undefined
      };
    }
    if (prefix === "c") {
      const info = settingsTabInfo(a);
      return {
        kind: "Настройка",
        title: entry.label,
        meta: [`Настройки → ${info?.label ?? a}`],
        body: info ? settingsScopeText(info.scope, workspace?.name) ?? undefined : undefined
      };
    }
    if (prefix === "p") return { kind: "Раздел", title: entry.label, meta: ["Откроется вкладкой в доке или перейдёт к уже открытой"] };
    return { kind: "Действие", title: entry.label, meta: [] };
  }

  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, ordered.length - 1)));
  }, [ordered.length]);

  function runCommand(cmd: Command | undefined): void {
    if (!cmd) return;
    setPaletteOpen(false);
    cmd.run();
  }

  function runActive(): void {
    runCommand(activeEntry);
  }

  async function submitCapture(event: FormEvent): Promise<void> {
    event.preventDefault();
    const resolved = resolveQuickCapture(capture, { tasks: isEnabled("tasks"), notes: isEnabled("notes"), lists: isEnabled("lists") });
    if (resolved.kind === "error") {
      toast({ title: resolved.message, tone: "danger" });
      return;
    }
    try {
      if (resolved.kind === "task") {
        await createTask.mutateAsync({
          title: resolved.title,
          description: "",
          dueAt: resolved.dueToday ? localDayDueAt(new Date()) : null,
          projectTag: resolved.projectTag ?? null,
          priority: "normal"
        });
        toast({ title: "Задача добавлена", tone: "success" });
      } else if (resolved.kind === "note") {
        await createNote.mutateAsync({ title: resolved.title, body: "", tags: [] });
        toast({ title: "Заметка добавлена", tone: "success" });
      } else if (resolved.kind === "list") {
        const { list, added } = await captureToList(resolved.text);
        toast({
          title: added > 1 ? `Добавлено в «${list.name}»: ${added}` : `Добавлено в «${list.name}»`,
          action: { label: "Открыть", onClick: () => openList(list.id, list.name) },
          tone: "success"
        });
      } else {
        await captureInbox.mutateAsync({ title: resolved.title, body: "", kind: "inbox" });
        toast({ title: "Добавлено в инбокс", tone: "success" });
      }
      setCaptureOpen(false);
    } catch {
      toast({ title: "Не удалось сохранить", tone: "danger" });
    }
  }

  return (
    <>
      <Modal open={paletteOpen} onClose={() => setPaletteOpen(false)} title="Поиск и команды" size="lg" returnFocus={false}>
        <div className="space-y-3">
          <Input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="Поиск по задачам, заметкам, проектам, файлам…"
            aria-label="Поиск команд и записей"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, ordered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                runActive();
              }
            }}
          />
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem]">
            <div className="max-h-80 overflow-y-auto">
              {ordered.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">{searchPending ? "Ищу…" : "Ничего не найдено"}</p>
              ) : (
                groups.map((group) => (
                  <section key={group.group} aria-label={group.group} className="mb-2 last:mb-0">
                    <h3 className="px-2.5 pb-1 pt-1.5 text-micro uppercase tracking-wide text-subtle-foreground">{group.group}</h3>
                    <ul className="space-y-0.5">
                      {group.items.map(({ entry: cmd, index: i }) => {
                        const Icon = cmd.icon;
                        return (
                          <li key={cmd.entityKey ?? cmd.id} className="flex items-center gap-1">
                            <button
                              type="button"
                              onMouseEnter={() => setActiveIndex(i)}
                              onClick={() => runCommand(cmd)}
                              className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
                                i === activeIndex ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/5"
                              }`}
                            >
                              <Icon className="h-4 w-4 shrink-0 text-subtle-foreground" />
                              <span className="flex-1 truncate">{cmd.label}</span>
                              {cmd.hint ? <span className="text-2xs text-subtle-foreground">{cmd.hint}</span> : null}
                              {i === activeIndex ? <CornerDownLeft className="h-3.5 w-3.5 text-subtle-foreground" /> : null}
                            </button>
                            {cmd.view ? <ObjectOpenMenu view={cmd.view} title={cmd.label} beforeOpen={() => setPaletteOpen(false)} /> : null}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))
              )}
            </div>
            <PreviewPane preview={previewOf(activeEntry)} />
          </div>
          <div className="flex items-center justify-end gap-1 border-t border-border pt-2 text-2xs text-subtle-foreground">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            навигация
            <span className="mx-1">·</span>
            <Kbd>Enter</Kbd>
            выбрать
          </div>
        </div>
      </Modal>

      <Modal open={captureOpen} onClose={() => setCaptureOpen(false)} title="Быстрый ввод" size="sm">
        <form onSubmit={submitCapture} className="space-y-3">
          <Input
            autoFocus
            value={capture}
            onChange={(e) => setCapture(e.target.value)}
            placeholder={quickCapturePlaceholder({ tasks: isEnabled("tasks"), notes: isEnabled("notes"), lists: isEnabled("lists") })}
          />
          <p className="text-2xs text-subtle-foreground">
            Enter — в инбокс. «/task » и «/note » создают задачу или заметку сразу. «!» — задача на сегодня, «#тег» — проект.
          </p>
        </form>
      </Modal>

      {gotoArmed ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center px-4">
          <div className="flex max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-2xl border border-border bg-background/95 px-4 py-2 text-label text-muted-foreground shadow-lg">
            <span className="text-foreground">Переход</span>
            {GOTO_PANELS.map((item) => (
              <span key={item.key} className="inline-flex items-center gap-1">
                <Kbd>{item.key.toUpperCase()}</Kbd>
                {item.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * Command Menu's right-hand pane (wide windows only): what the highlighted entry is before it is
 * opened — a task's status and due date, the start of a note, where a setting lives and whom it
 * affects. Plain text, no controls: acting stays in the list on the left.
 */
function PreviewPane({ preview }: { preview: PalettePreview | null }): React.ReactElement {
  return (
    <aside aria-label="Предпросмотр" className="hidden min-w-0 rounded-xl border border-border bg-white/[0.02] p-3 md:block">
      {preview ? (
        <div className="space-y-2">
          <p className="text-micro uppercase tracking-wide text-subtle-foreground">{preview.kind}</p>
          <p className="break-words text-sm font-medium text-foreground">{preview.title}</p>
          {preview.meta.length > 0 ? (
            <ul className="space-y-0.5 text-2xs text-muted-foreground">
              {preview.meta.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          ) : null}
          {preview.body ? <p className="whitespace-pre-line break-words border-t border-border pt-2 text-xs text-muted-foreground">{preview.body}</p> : null}
        </div>
      ) : (
        <p className="text-2xs text-subtle-foreground">Наведите на строку или выберите стрелками — здесь появится краткое содержание.</p>
      )}
    </aside>
  );
}
