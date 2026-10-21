import { EMPTY_TASK_FILTERS } from "../features/tasks/task-filters";
import { MarkdownPreview } from "../features/markdown-preview";
import type { TaskSort, NoteSort } from "../features/view-order";
import { EntryFields } from "../features/entry-fields";
import type { AppRoute } from "./navigation/routes";
import { useRepository } from "./use-repository";
import { useNavigation } from "./navigation/use-navigation";
import { useSettingWrites } from "./settings/use-setting-writes";
import { SettingsCenter } from "./settings/settings-center";
import { SETTINGS_PAGES } from "./settings/catalog";
import { createBuiltinModules } from "./bootstrap";
import { AppHeader, BottomNavigation } from "./shell/app-chrome";
import { MorePage } from "./shell/more-page";
import { ModuleOutlet } from "./shell/module-outlet";
import { EntryActions } from "../entry-actions";
import { DepthCard } from "../depth-card";
import React, { useEffect, useRef, useState } from "react";
import { App as NativeApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { MoreHorizontal, ArrowLeft, Plus, ListTodo, NotebookPen, Smartphone, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { lanProfileSchema, createPortableBackup, appendDictation, type Draft } from "@orion/mobile-core";
import { isTaskClosed, type Task, type Note } from "@orion/shared-types";
import { QuickActions } from "../quick-actions";
import { Dictation } from "../dictation";
import { useUpdates } from "../use-updates";
import { useLan } from "../use-lan";
import { ConnectionPage } from "../connection";
import { exportBackup } from "../backup";
import { useDepth } from "../use-depth";
import { useVisualMotion } from "../use-motion";
import { applyMobileTheme } from "../theme";

const emptyDraft = (kind: "task" | "note"): Draft => ({ kind, id: null, title: "", body: "", priority: "normal" });
const errorText = (error: unknown) => error instanceof Error && !("issues" in error)
  ? error.message : "Не удалось сохранить. Проверьте название и повторите — введённый текст остаётся здесь.";

export default function App() {
  const { repo, data, setData, loading, busy, setBusy, error, setError, notice, setNotice, open, action } = useRepository();
  const draftWrites = useRef(0); const draftWriteError = useRef(false);
  const listWrites = useRef(0); const listWriteError = useRef(false);
  const financeWrites = useRef(0); const financeWriteError = useRef(false);
  const navigation = useNavigation(() => {
    if (draftWrites.current || listWrites.current || financeWrites.current || draftWriteError.current || listWriteError.current || financeWriteError.current) {
      setError("Дождитесь сохранения черновика. Если запись не удалась, повторите сохранение или отмените ввод, прежде чем уходить."); return false;
    }
    return true;
  });
  const canLeave = navigation.canLeave;
  const tab = navigation.route.kind === "module" ? navigation.route.moduleId : navigation.route.kind;
  const setTab = (id: string) => navigate(id === "settings" || id === "connection" || id === "more" ? { kind: id } : { kind: "module", moduleId: id });
  const settingWrites = useSettingWrites(repo.current, setData);
  const [entryMenu, setEntryMenu] = useState<{ kind: "task" | "note"; id: string } | null>(null);
  const [editor, setEditor] = useState<Draft | null>(null);
  const [taskQuery, setTaskQuery] = useState("");
  const [noteQuery, setNoteQuery] = useState("");
  const [taskSort, setTaskSort] = useState<TaskSort>("manual");
  const [noteSort, setNoteSort] = useState<NoteSort>("updated");
  const [taskFilters, setTaskFilters] = useState({ ...EMPTY_TASK_FILTERS });
  const [noteTag, setNoteTag] = useState("");
  const [pinnedNotes, setPinnedNotes] = useState(false);
  const [archive, setArchive] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [financeLaunch, setFinanceLaunch] = useState<{ id: number; type: "income" | "expense" } | null>(null);
  const [address, setAddress] = useState("");
  const [port, setPort] = useState("4443");
  const heading = useRef<HTMLHeadingElement>(null);
  const updates = useUpdates(data?.settings);
  const theme = data?.settings.theme ?? "system";
  const depth = useDepth(data?.settings.depthEffects ?? false, data?.settings.depthStrength ?? 60);
  useVisualMotion(data ? `${tab}:${editor ? editor.kind + ":" + (editor.id ?? "new") : "list"}` : "startup");
  const connection = useLan(repo.current, setData);
  const remote = data?.remoteActive && data.remoteSelection && connection.client &&
    (["nodeId", "fingerprint", "userId", "workspaceId"] as const).every((key) => connection.client!.scope[key] === data.remoteSelection![key]) ? connection.client : null;
  function navigate(route: AppRoute, replace = false) {
    navigation.navigate(route.kind === "module" ? { ...route, scope: route.moduleId === "finance" ? "phone" : remote?.key ?? "phone" } : route, replace);
  }
  const remoteRequested = Boolean(data?.remoteActive);
  const currentDraft = remote ? data?.remoteDrafts[remote.key] ?? null : data?.draft ?? null;

  const storedAddress = data?.lan?.address ?? "";
  const storedPort = data?.lan?.port ?? 4443;
  useEffect(() => { setAddress(storedAddress); setPort(String(storedPort)); }, [storedAddress, storedPort]);
  useEffect(() => {
    const back = () => { if (!canLeave()) return; setEditor(null); setError(""); };
    window.addEventListener("popstate", back);
    const listener = Capacitor.isNativePlatform() ? NativeApp.addListener("backButton", () => {
      if (!window.dispatchEvent(new Event("orion-back", { cancelable: true }))) return;
      if (!canLeave()) return;
      if (history.state?.editor || (history.state?.appRoute && "backHash" in history.state)) history.back();
      else void NativeApp.exitApp();
    }) : null;
    return () => { window.removeEventListener("popstate", back); void listener?.then((handle) => handle.remove()); };
  }, [setError, canLeave]);
  useEffect(() => { setEntryMenu(null); }, [tab, editor?.kind, editor?.id]);
  const activeSettingsPage = navigation.route.kind === "settings" ? navigation.route.page : undefined;
  useEffect(() => { heading.current?.focus(); }, [tab, activeSettingsPage, editor?.kind, editor?.id]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: light)");
    const apply = () => applyMobileTheme(theme, data?.settings.darkTheme ?? "kaiden-precision", media.matches);
    apply(); media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme, data?.settings.darkTheme]);

  function begin(draft: Draft) {
    setEditor(draft); setError(""); setNotice("");
    navigation.openEditor();
  }
  function changeDraft(next: Draft) {
    setEditor(next); setNotice("Сохраняем черновик…");
    draftWrites.current++;
    const save = remote ? repo.current?.saveRemoteDraft(remote.key, next) : repo.current?.saveDraft(next);
    void save?.then(() => {
      draftWriteError.current = false; setData(repo.current!.snapshot()); setNotice("Черновик сохранён на телефоне");
    }).catch(() => { draftWriteError.current = true; setError("Черновик не записан на диск. Не закрывайте редактор; попробуйте сохранить ещё раз."); setNotice(""); }).finally(() => { draftWrites.current--; });
  }
  function editTask(task: Task) {
    begin({ kind: "task", id: task.id, title: task.title, body: task.description, priority: task.priority, status: task.status, dueAt: task.dueAt, startAt: task.startAt, estimatedMinutesText: task.estimatedMinutes?.toString() ?? "",
      ...(remote ? { expectedRevision: remote.revision("task", task.id) } : {}) });
  }
  function editNote(note: Note) {
    begin({ kind: "note", id: note.id, title: note.title, body: note.body, priority: "normal", summary: note.summary, tagsText: note.tags.join(", "), pinnedAt: note.pinnedAt,
      ...(remote ? { expectedRevision: remote.revision("note", note.id) } : {}) });
  }
  const saveEntry = (draft: Draft) => action(async (value) => {
    if (remote) { await remote.saveEntry(draft); await value.saveRemoteDraft(remote.key, null); }
    else await value.saveEntry(draft);
    draftWriteError.current = false;
  }, remote ? "Сохранено в копии. Нажмите «Синхронизировать» для отправки на ПК." : "Сохранено на телефоне");
  async function backup() {
    if (!repo.current || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const snapshot = repo.current.snapshot();
      const client = connection.client;
      const selection = snapshot.remoteSelection;
      const payload = createPortableBackup(snapshot, client && selection ? {
        nodeId: selection.nodeId, workspaceId: selection.workspaceId, workspaceName: selection.workspaceName,
        tasks: client.engine.tasks(), notes: client.engine.notes(), lists: client.engine.lists().lists,
        conflicts: client.engine.conflicts().map((entry) => ({
          entity: entry.op.entity, entityId: entry.op.entityId, fields: entry.op.fields, lost: entry.lost, outcome: entry.outcome,
        })),
      } : null);
      if (await exportBackup(payload)) {
        await repo.current.markBackup(snapshot.deviceSeq); setData(repo.current.snapshot()); setNotice("Резервная копия записана в выбранный файл.");
      } else setNotice(Capacitor.isNativePlatform() ? "Экспорт отменён. Резервная копия не отмечена как сохранённая." : "Копия передана браузеру для скачивания. Подтверждение записи доступно в Android.");
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  const feedback = <>{error && <p className="error" role="alert">{error}</p>}<p className="notice" role="status">{notice}</p></>;
  if (!data) return <main className="startup"><img src="/kaiden-logo.png" alt="" width="64" height="64" />
    <h1>KAIDEN Orion</h1><p>{loading ? "Открываем локальное пространство…" : "Локальное пространство недоступно"}</p>
    {feedback}{!loading && <button onClick={() => void open()}>Повторить открытие</button>}</main>;
  if (remoteRequested && !remote && navigation.route.kind === "module" && tab !== "finance") return <main className="startup"><h1>{connection.error ? "Копия пространства недоступна" : "Открываем копию пространства…"}</h1>
    {connection.error && <p className="error" role="alert">{connection.error}</p>}
    <button onClick={() => void connection.switchSpace(false)}>Открыть записи «На телефоне»</button></main>;

  if (editor) return <div className="shell"><header className="editor-bar">
    <button className="icon-button" aria-label="Назад к списку, оставить черновик" disabled={busy || dictating} onClick={() => history.back()}><ArrowLeft /></button>
    <h1 ref={heading} tabIndex={-1}>{editor.kind === "task" ? "Задача" : "Заметка"}</h1>
    <button className="primary" disabled={busy || dictating || !editor.title.trim()} onClick={async () => {
      if (await saveEntry(editor)) history.back();
    }}>Сохранить</button>
  </header><DepthCard><main className="editor">
    <p className="scope"><Smartphone size={16} /> {remote ? data.remoteSelection?.workspaceName + " · локальная копия ПК" : "Только на этом телефоне"}</p>
    <Dictation disabled={busy} activity={setDictating}
      prepare={async () => {
        if (!repo.current) throw new Error("Хранилище недоступно");
        try { if (remote) await repo.current.saveRemoteDraft(remote.key, editor); else await repo.current.saveDraft(editor); }
        catch { throw new Error("Черновик не записан. Диктовка не запущена; повторите сохранение и попробуйте снова."); }
        setData(repo.current.snapshot());
      }}
      apply={async (text, field, id) => {
        if (!repo.current) throw new Error("Хранилище недоступно");
        const next = appendDictation(editor, text, field, id);
        try { if (remote) await repo.current.saveRemoteDraft(remote.key, next); else await repo.current.saveDraft(next); }
        catch { throw new Error("Не удалось записать текст в черновик. Результат диктовки сохранён отдельно; освободите место и повторите добавление."); }
        setEditor(next); setData(repo.current.snapshot());
      }} />
    <label>Название<input aria-label="Название" value={editor.title} maxLength={200} placeholder={editor.kind === "task" ? "Что нужно сделать?" : "О чём эта заметка?"}
      disabled={busy || dictating} onChange={(e) => changeDraft({ ...editor, title: e.target.value })} /></label>
    {!editor.title.trim() && <p className="helper">Добавьте название, чтобы сохранить запись.</p>}
    <label>{editor.kind === "task" ? "Описание" : "Текст заметки"}
      <textarea aria-label={editor.kind === "task" ? "Описание" : "Текст заметки"} value={editor.body} maxLength={20000} rows={12} disabled={busy || dictating}
        placeholder={editor.kind === "task" ? "Детали, которые пригодятся позже" : "Пишите свободно. Разметка Markdown сохранится."}
        onChange={(e) => changeDraft({ ...editor, body: e.target.value })} /></label>
    {editor.kind === "task" && <fieldset disabled={busy || dictating}><legend>Приоритет</legend><div className="segments">
      {([["low", "Низкий"], ["normal", "Обычный"], ["high", "Высокий"]] as const).map(([value, label]) =>
        <label key={value}><input type="radio" name="priority" checked={editor.priority === value} onChange={() => changeDraft({ ...editor, priority: value })} /><span>{label}</span></label>)}
    </div></fieldset>}
    <MarkdownPreview source={editor.body} />
    <EntryFields draft={editor} disabled={busy || dictating} change={changeDraft} />
    <p className="helper">{editor.body.length.toLocaleString("ru-RU")} / 20 000 символов</p>
    {feedback}<button className="text-button" disabled={busy || dictating} onClick={async () => {
      if (await action((value) => remote ? value.saveRemoteDraft(remote.key, null).then(() => { draftWriteError.current = false; }) : value.saveDraft(null).then(() => { draftWriteError.current = false; }), "Черновик отменён")) history.back();
    }}>Отменить изменения</button>
  </main></DepthCard></div>;

  const entryActions = (kind: "task" | "note", item: Task | Note) => entryMenu?.kind === kind && entryMenu.id === item.id
    ? <EntryActions key={kind + item.id} kind={kind} title={item.title} remote={Boolean(remote)} busy={busy}
      close={() => setEntryMenu(null)} edit={() => { setEntryMenu(null); if (currentDraft) begin(currentDraft); else if (kind === "task") editTask(item as Task); else editNote(item as Note); }}
      remove={() => action(async (value) => {
        if (remote) { await remote.deleteEntry(kind, item.id); if (currentDraft?.kind === kind && currentDraft.id === item.id) await value.saveRemoteDraft(remote.key, null); }
        else await value.deleteEntry(kind, item.id);
      }, remote ? "Удаление сохранено в копии. Синхронизируйте для отправки на ПК." : "Запись удалена с телефона")} /> : null;
  const menuButton = (kind: "task" | "note", item: Task | Note) => <button className="icon-button entry-menu-button" disabled={busy}
    aria-label={(kind === "task" ? "Действия задачи: " : "Действия заметки: ") + item.title}
    aria-expanded={entryMenu?.kind === kind && entryMenu.id === item.id}
    onClick={() => setEntryMenu(entryMenu?.kind === kind && entryMenu.id === item.id ? null : { kind, id: item.id })}><MoreHorizontal size={20} /></button>;
  const taskNeedle = taskQuery.toLocaleLowerCase();
  const noteNeedle = noteQuery.toLocaleLowerCase();
  const ranks = new Map((data.taskOrder[remote?.key ?? "phone"] ?? []).map((id, index) => [id, index]));
  const tasks = (remote ? remote.engine.tasks() : data.tasks).filter((item) => (item.title + " " + item.description).toLocaleLowerCase().includes(taskNeedle))
    .sort((a, b) => Number(isTaskClosed(a.status)) - Number(isTaskClosed(b.status)) || (ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER) || b.updatedAt.localeCompare(a.updatedAt));
  const notes = (remote ? remote.engine.notes() : data.notes).filter((item) => Boolean(item.archivedAt) === archive
    && (item.title + " " + item.summary + " " + item.body + " " + item.tags.join(" ")).toLocaleLowerCase().includes(noteNeedle)).sort((a, b) => Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt)) || b.updatedAt.localeCompare(a.updatedAt));
  const quickEntry = (kind: "task" | "note") => {
    if (financeWrites.current || financeWriteError.current) { setError("Сначала сохраните или отмените ввод финансов. Не удалось подтвердить запись черновика."); return; }
    if (currentDraft) { begin(currentDraft); setNotice("Открыт незавершённый черновик. Сохраните или отмените его перед новой записью."); }
    else begin({ ...emptyDraft(kind), ...(remote ? { id: crypto.randomUUID() } : {}) });
  };
  const quickFinance = (type: "income" | "expense") => {
    if (financeWrites.current || financeWriteError.current) { setError("Текущий ввод финансов ещё не записан. Сохраните или отмените его перед новой операцией."); return; }
    setTab("finance"); setError("");
    if (data.finance?.draft) { setNotice("Открыт незавершённый ввод финансов. Он не заменён новой операцией."); return; }
    setFinanceLaunch({ id: Date.now(), type }); setNotice("");
  };
  const modules = createBuiltinModules({
    lists: { lists: remote ? remote.engine.lists().lists : data.lists, initialDraft: data.listDrafts[remote?.key ?? "phone"] ?? null,
      busy, available: !remote || remote.hasModule("list"), canItems: !remote || remote.hasModule("listItem"), remote: Boolean(remote),
      selectedId: navigation.route.kind === "module" ? navigation.route.entityId : undefined,
      select: (entityId) => navigate({ kind: "module", moduleId: "lists", ...(entityId ? { entityId } : {}) }),
      saveDraft: async (draft) => {
        if (!repo.current) throw new Error("Хранилище недоступно"); listWrites.current++;
        try { await repo.current.saveListDraft(remote?.key ?? "phone", draft); listWriteError.current = false; setData(repo.current.snapshot()); }
        catch (error) { listWriteError.current = true; throw error; } finally { listWrites.current--; }
      },
      mutate: (mutation, draft) => action(async (value) => {
        const scope = remote?.key ?? "phone";
        if (draft) { await value.saveListDraft(scope, draft); listWriteError.current = false; }
        if (remote) {
          await remote.mutateList(mutation);
          const savedDraft = value.snapshot().listDrafts[scope];
          if (draft || (mutation.kind === "delete" && savedDraft && (savedDraft.id === mutation.id || (mutation.entity === "list" && savedDraft.parentId === mutation.id)))) await value.saveListDraft(scope, null);
        } else await value.mutateList(mutation, Boolean(draft));
      }, remote ? "Изменение списка сохранено в копии. Синхронизируйте для отправки на ПК." : "Список сохранён на телефоне") },
    tasks: { tasks, sort: taskSort, setSort: setTaskSort, filters: taskFilters, setFilters: setTaskFilters, query: taskQuery, setQuery: setTaskQuery, busy, remote: Boolean(remote), available: !remote || remote.hasModule("task"),
      edit: (task) => currentDraft ? begin(currentDraft) : editTask(task),
      done: (task) => void action((value) => remote ? remote.setTaskDone(task.id, !isTaskClosed(task.status)) : value.setTaskDone(task.id, !isTaskClosed(task.status)), "Задача сохранена"),
      reorder: (ids) => action((value) => value.saveTaskOrder(remote?.key ?? "phone", ids), "Порядок задач сохранён на телефоне"),
      menu: (task) => menuButton("task", task), actions: (task) => entryActions("task", task) },
    notes: { notes, sort: noteSort, setSort: setNoteSort, tag: noteTag, setTag: setNoteTag, pinned: pinnedNotes, setPinned: setPinnedNotes, query: noteQuery, setQuery: setNoteQuery, busy, archive, setArchive, remote: Boolean(remote), available: !remote || remote.hasModule("note"),
      edit: (note) => currentDraft ? begin(currentDraft) : editNote(note),
      archiveNote: (note) => void action((value) => remote ? remote.archiveNote(note.id, !archive) : value.archiveNote(note.id, !archive), archive ? "Заметка возвращена" : "Заметка в архиве — её можно вернуть"),
      menu: (note) => menuButton("note", note), actions: (note) => entryActions("note", note) },
    finance: { finance: data.finance!, busy, initialType: financeLaunch?.type, launchKey: financeLaunch?.id,
        saveDraft: async (draft) => {
          if (!repo.current) return;
          financeWrites.current++;
          try { await repo.current.saveFinanceDraft(draft); financeWriteError.current = false; setData(repo.current.snapshot()); }
          catch (cause) { financeWriteError.current = true; throw cause; }
          finally { financeWrites.current--; }
        },
        save: async (draft) => { const saved = await action((value) => value.saveFinanceEntry(draft), "Операция сохранена на телефоне"); if (saved) financeWriteError.current = false; return saved; },
        remove: (id) => action((value) => value.deleteFinanceEntry(id), "Операция удалена") },
    createTask: () => quickEntry("task"), createNote: () => quickEntry("note"),
  });
  const scopeMismatch = navigation.route.kind === "module" && navigation.route.scope && navigation.route.scope !== (tab === "finance" ? "phone" : remote?.key ?? "phone");
  const activeModule = scopeMismatch ? undefined : modules.find((item) => item.id === tab);
  const settingsPageId = navigation.route.kind === "settings" ? navigation.route.page : undefined;
  const settingsPage = SETTINGS_PAGES.find((item) => item.id === settingsPageId);
  return <QuickActions disabled={busy || dictating} actions={[
    { id: "task", label: "Задача", icon: ListTodo, disabled: remote ? !remote.hasModule("task") : false, run: () => quickEntry("task") },
    { id: "note", label: "Заметка", icon: NotebookPen, disabled: remote ? !remote.hasModule("note") : false, run: () => quickEntry("note") },
    { id: "expense", label: "Расход", icon: ArrowUpRight, run: () => quickFinance("expense") },
    { id: "income", label: "Доход", icon: ArrowDownLeft, run: () => quickFinance("income") },
  ]}><div className="shell"><AppHeader scope={remote && tab !== "finance" ? data.remoteSelection?.workspaceName ?? "Копия ПК" : "На телефоне"}
      updated={Boolean(updates.state?.available)} settings={() => setTab("settings")} connection={() => setTab("connection")} />
    <main className="content">
      <DepthCard elevation="base"><div className="page-heading"><div><h1 ref={heading} tabIndex={-1}>{tab === "settings" ? settingsPage?.label ?? "Настройки" : tab === "connection" ? "Связь с компьютером" : tab === "more" ? "Ещё" : activeModule?.label ?? "Раздел"}</h1>
        <p>{tab === "tasks" && tasks.length ? `Открыто: ${tasks.filter((task) => !isTaskClosed(task.status)).length} · Завершено: ${tasks.filter((task) => isTaskClosed(task.status)).length}` : activeModule?.summary ?? (tab === "settings" ? "Настройте Orion под себя." : tab === "more" ? "Все доступные разделы рядом." : "Ваше пространство — рядом, даже без сети.")}</p></div>
      {activeModule?.primary && <button className="primary" disabled={activeModule.primary.disabled} onClick={activeModule.primary.run}><Plus size={20} /><span>{activeModule.primary.label}</span></button>}</div></DepthCard>
      {feedback}
      {remote && tab !== "connection" && tab !== "finance" && <div className="replica-banner"><p>Копия пространства ПК · в очереди {remote.engine.status().pending} · конфликтов {remote.engine.status().conflicts}</p>
        <button disabled={connection.busy} onClick={() => { setTab("connection"); void connection.sync(); }}>Синхронизировать</button></div>}
      {currentDraft && tab !== "finance" && <button className="draft-banner" onClick={() => begin(currentDraft)}><NotebookPen size={20} /><span>Продолжить черновик<strong>{currentDraft.title || "Без названия"}</strong></span></button>}
      {navigation.route.kind === "settings" ? <SettingsCenter route={navigation.route} navigate={navigate} replace={(route) => navigate(route, true)}
        data={data} writes={settingWrites} updates={updates} depth={depth} backup={() => void backup()} backupBusy={busy} note={() => quickEntry("note")}
        connection={{ paired: Boolean(connection.state?.paired), pending: remote?.engine.status().pending ?? 0, conflicts: remote?.engine.status().conflicts ?? 0 }} />
        : tab === "more" ? <MorePage modules={modules} navigate={navigate} />
        : tab === "connection" ? <ConnectionPage data={data} connection={connection} address={address} port={port}
        setAddress={setAddress} setPort={setPort} busy={busy} backup={() => void backup()}
        saveProfile={() => { const result = lanProfileSchema.safeParse({ address, port: Number(port) });
          if (!result.success) { setError(result.error.issues[0]?.message ?? "Проверьте адрес и порт"); return; }
          void action((value) => value.saveLan(result.data), "Профиль сохранён. Подключение пока не выполнялось.");
        }} />
        : <ModuleOutlet definition={activeModule} scope={remote?.key ?? "phone"} />}

    </main>
    <BottomNavigation items={modules} selected={activeModule?.id ?? "more"} navigate={(id) => { setTab(id); setError(""); setNotice(""); }} />
  </div></QuickActions>;
}


