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
  ListTodo,
  Plus,
  Receipt,
  StickyNote,
  type LucideIcon
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { focusNote, focusTask, openPanel, openProject } from "./panel-bus";
import { panelRegistry } from "./panel-registry";
import { useActiveWorkspace } from "./use-active-workspace";
import { useEnabledModules } from "./use-enabled-modules";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  run: () => void;
  /** Came from the server-side search, so it's already matched and ranked — don't re-filter it by substring. */
  serverResult?: boolean;
}

/** Which panel a search hit of each type opens. */
const PANEL_FOR_TYPE: Record<string, string> = {
  project: "projects",
  task: "tasks",
  note: "notes",
  event: "calendar",
  document: "documents",
  transaction: "finance"
};

/** Icon + panel for a server-side search hit, by entity type (`GlobalSearchResult.type`). */
const SEARCH_RESULT_ICONS: Record<string, LucideIcon> = {
  project: FolderKanban,
  task: ListTodo,
  note: StickyNote,
  event: CalendarDays,
  document: FileText,
  transaction: Receipt
};
const SEARCH_RESULT_LABELS: Record<string, string> = {
  project: "проект",
  task: "задача",
  note: "заметка",
  event: "событие",
  document: "документ",
  transaction: "операция"
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
  { key: "o", panelId: "documents", label: "Документы" },
  { key: "y", panelId: "sync", label: "Синхронизация" },
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
  const { toast } = useToast();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [capture, setCapture] = useState("");
  const [capturePrefill, setCapturePrefill] = useState("");
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
      if (panel.moduleId && !isModuleEnabled(disabledModules, panel.moduleId)) continue;
      base.push({
        id: `p:${panel.id}`,
        label: panel.label,
        hint: "панель",
        icon: panel.icon,
        run: () => openPanel(panel.id)
      });
    }
    if (isEnabled("tasks")) {
      for (const task of tasks ?? []) {
        base.push({
          id: `t:${task.id}`,
          label: task.title,
          hint: "задача",
          icon: ListTodo,
          run: () => focusTask(task.id)
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
          run: () => focusNote(note.id)
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
        run: () => {
          if (hit.type === "task") {
            focusTask(hit.id);
            return;
          }
          if (hit.type === "note") {
            focusNote(hit.id);
            return;
          }
          if (hit.type === "project") {
            openProject(hit.id, hit.title);
            return;
          }
          openPanel(PANEL_FOR_TYPE[hit.type] ?? "dashboard");
        }
      });
    }
    return base;
  }, [tasks, notes, searchHits, disabledModules, isEnabled]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? commands.filter((c) => c.serverResult || c.label.toLowerCase().includes(q)) : commands;
    return list.slice(0, 16);
  }, [commands, query]);

  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, results.length - 1)));
  }, [results.length]);

  function runCommand(cmd: Command | undefined): void {
    if (!cmd) return;
    setPaletteOpen(false);
    cmd.run();
  }

  function runActive(): void {
    runCommand(results[activeIndex]);
  }

  async function submitCapture(event: FormEvent): Promise<void> {
    event.preventDefault();
    const resolved = resolveQuickCapture(capture, { tasks: isEnabled("tasks"), notes: isEnabled("notes") });
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
      <Modal open={paletteOpen} onClose={() => setPaletteOpen(false)} size="md">
        <div className="space-y-3">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по задачам, заметкам, проектам, файлам…"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                runActive();
              }
            }}
          />
          <ul className="max-h-72 space-y-0.5 overflow-y-auto">
            {results.length === 0 ? (
              <li className="px-2 py-6 text-center text-xs text-muted-foreground">
                {searchPending ? "Ищу…" : "Ничего не найдено"}
              </li>
            ) : (
              results.map((cmd, i) => {
                const Icon = cmd.icon;
                return (
                  <li key={cmd.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => runCommand(cmd)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                        i === activeIndex ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/5"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-subtle-foreground" />
                      <span className="flex-1 truncate">{cmd.label}</span>
                      {cmd.hint ? <span className="text-2xs text-subtle-foreground">{cmd.hint}</span> : null}
                      {i === activeIndex ? <CornerDownLeft className="h-3.5 w-3.5 text-subtle-foreground" /> : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
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
            placeholder={quickCapturePlaceholder({ tasks: isEnabled("tasks"), notes: isEnabled("notes") })}
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
