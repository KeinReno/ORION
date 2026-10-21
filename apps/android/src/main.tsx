import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { App as NativeApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { ArrowLeft, Plus, Search, Check, ListTodo, NotebookPen, Link2, Archive, RotateCcw, Smartphone, Settings } from "lucide-react";
import { MobileRepository, lanProfileSchema, createPortableBackup, type Draft, type MobileSnapshot } from "@orion/mobile-core";
import { isTaskClosed, type Task, type Note } from "@orion/shared-types";
import { storage } from "./storage";
import { SettingsPage } from "./settings";
import { useUpdates } from "./use-updates";
import { useLan } from "./use-lan";
import { ConnectionPage } from "./connection";
import { exportBackup } from "./backup";
import "./style.css";

type Tab = "tasks" | "notes" | "connection" | "settings";
const emptyDraft = (kind: "task" | "note"): Draft => ({ kind, id: null, title: "", body: "", priority: "normal" });
const errorText = (error: unknown) => error instanceof Error && !("issues" in error)
  ? error.message : "Не удалось сохранить. Проверьте название и повторите — введённый текст остаётся здесь.";

function App() {
  const repo = useRef<MobileRepository | null>(null);
  const [data, setData] = useState<MobileSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>("tasks");
  const [editor, setEditor] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [archive, setArchive] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [address, setAddress] = useState("");
  const [port, setPort] = useState("4443");
  const heading = useRef<HTMLHeadingElement>(null);
  const updates = useUpdates(data?.settings);
  const theme = data?.settings.theme ?? "system";
  const connection = useLan(repo.current, setData);
  const remote = data?.remoteActive && data.remoteSelection && connection.client &&
    (["nodeId", "fingerprint", "userId", "workspaceId"] as const).every((key) => connection.client!.scope[key] === data.remoteSelection![key]) ? connection.client : null;
  const remoteRequested = Boolean(data?.remoteActive);
  const currentDraft = remote ? data?.remoteDrafts[remote.key] ?? null : data?.draft ?? null;

  async function open() {
    setLoading(true); setError("");
    try {
      repo.current = await MobileRepository.open(storage);
      const snapshot = repo.current.snapshot();
      setData(snapshot); setAddress(snapshot.lan?.address ?? "");
      setPort(String(snapshot.lan?.port ?? 4443));
    } catch { setError("Не удалось открыть локальные данные. Они не удалены. Повторите открытие; если ошибка остаётся, сохраните данные приложения для восстановления."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void open(); }, []);
  useEffect(() => {
    const back = () => { setEditor(null); setError(""); };
    window.addEventListener("popstate", back);
    const listener = Capacitor.isNativePlatform() ? NativeApp.addListener("backButton", () => {
      if (history.state?.editor) history.back();
      else void NativeApp.exitApp();
    }) : null;
    return () => { window.removeEventListener("popstate", back); void listener?.then((handle) => handle.remove()); };
  }, []);
  useEffect(() => { heading.current?.focus(); }, [tab, editor?.kind, editor?.id]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  async function action(work: (value: MobileRepository) => Promise<void>, message: string) {
    if (!repo.current || busy) return false;
    setBusy(true); setError(""); setNotice("");
    try {
      await work(repo.current); setData(repo.current.snapshot()); setNotice(message); return true;
    } catch (e) { setError(errorText(e)); return false; }
    finally { setBusy(false); }
  }
  function begin(draft: Draft) {
    setEditor(draft); setError(""); setNotice("");
    history.pushState({ editor: true }, "", "#editor");
  }
  function changeDraft(next: Draft) {
    setEditor(next); setNotice("Сохраняем черновик…");
    const save = remote ? repo.current?.saveRemoteDraft(remote.key, next) : repo.current?.saveDraft(next);
    void save?.then(() => {
      setData(repo.current!.snapshot()); setNotice("Черновик сохранён на телефоне");
    }).catch(() => { setError("Черновик не записан на диск. Не закрывайте редактор; попробуйте сохранить ещё раз."); setNotice(""); });
  }
  function editTask(task: Task) {
    begin({ kind: "task", id: task.id, title: task.title, body: task.description, priority: task.priority,
      ...(remote ? { expectedRevision: remote.revision("task", task.id) } : {}) });
  }
  function editNote(note: Note) {
    begin({ kind: "note", id: note.id, title: note.title, body: note.body, priority: "normal",
      ...(remote ? { expectedRevision: remote.revision("note", note.id) } : {}) });
  }
  const saveEntry = (draft: Draft) => action(async (value) => {
    if (remote) { await remote.saveEntry(draft); await value.saveRemoteDraft(remote.key, null); }
    else await value.saveEntry(draft);
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
        tasks: client.engine.tasks(), notes: client.engine.notes(),
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
  if (remoteRequested && !remote) return <main className="startup"><h1>{connection.error ? "Копия пространства недоступна" : "Открываем копию пространства…"}</h1>
    {connection.error && <p className="error" role="alert">{connection.error}</p>}
    <button onClick={() => void connection.switchSpace(false)}>Открыть записи «На телефоне»</button></main>;

  if (editor) return <div className="shell"><header className="editor-bar">
    <button className="icon-button" aria-label="Назад к списку, оставить черновик" disabled={busy} onClick={() => history.back()}><ArrowLeft /></button>
    <h1 ref={heading} tabIndex={-1}>{editor.kind === "task" ? "Задача" : "Заметка"}</h1>
    <button className="primary" disabled={busy || !editor.title.trim()} onClick={async () => {
      if (await saveEntry(editor)) history.back();
    }}>Сохранить</button>
  </header><main className="editor">
    <p className="scope"><Smartphone size={16} /> {remote ? data.remoteSelection?.workspaceName + " · локальная копия ПК" : "Только на этом телефоне"}</p>
    <label>Название<input aria-label="Название" autoFocus value={editor.title} maxLength={200} placeholder={editor.kind === "task" ? "Что нужно сделать?" : "О чём эта заметка?"}
      disabled={busy} onChange={(e) => changeDraft({ ...editor, title: e.target.value })} /></label>
    {!editor.title.trim() && <p className="helper">Добавьте название, чтобы сохранить запись.</p>}
    <label>{editor.kind === "task" ? "Описание" : "Текст заметки"}
      <textarea aria-label={editor.kind === "task" ? "Описание" : "Текст заметки"} value={editor.body} maxLength={20000} rows={12} disabled={busy}
        placeholder={editor.kind === "task" ? "Детали, которые пригодятся позже" : "Пишите свободно. Разметка Markdown сохранится."}
        onChange={(e) => changeDraft({ ...editor, body: e.target.value })} /></label>
    {editor.kind === "task" && <fieldset disabled={busy}><legend>Приоритет</legend><div className="segments">
      {([["low", "Низкий"], ["normal", "Обычный"], ["high", "Высокий"]] as const).map(([value, label]) =>
        <label key={value}><input type="radio" name="priority" checked={editor.priority === value} onChange={() => changeDraft({ ...editor, priority: value })} /><span>{label}</span></label>)}
    </div></fieldset>}
    {feedback}<button className="text-button" disabled={busy} onClick={async () => {
      if (await action((value) => remote ? value.saveRemoteDraft(remote.key, null) : value.saveDraft(null), "Черновик отменён")) history.back();
    }}>Отменить изменения</button>
  </main></div>;

  const needle = query.toLocaleLowerCase();
  const tasks = (remote ? remote.engine.tasks() : data.tasks).filter((item) => (item.title + " " + item.description).toLocaleLowerCase().includes(needle))
    .sort((a, b) => Number(isTaskClosed(a.status)) - Number(isTaskClosed(b.status)) || b.updatedAt.localeCompare(a.updatedAt));
  const notes = (remote ? remote.engine.notes() : data.notes).filter((item) => Boolean(item.archivedAt) === archive
    && (item.title + " " + item.body).toLocaleLowerCase().includes(needle)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return <div className="shell"><header className="brand"><img src="/kaiden-logo.png" alt="" width="34" height="34" />
    <span>KAIDEN <b>Orion</b></span><button className="local-label" onClick={() => setTab("connection")}>{remote ? data.remoteSelection?.workspaceName : "На телефоне"}</button></header>
    <main className="content">
      <div className="page-heading"><div><h1 ref={heading} tabIndex={-1}>{tab === "tasks" ? "Задачи" : tab === "notes" ? "Заметки" : tab === "connection" ? "Связь с компьютером" : "Настройки"}</h1>
        <p>{tab === "tasks" ? "Освободите голову. Начните с одного дела." : tab === "notes" ? "Мысли и детали, к которым хочется вернуться." : tab === "connection" ? "Ваше пространство — рядом, даже без сети." : "Внешний вид и новые версии приложения."}</p></div>
      {(tab === "tasks" || tab === "notes") && <button className="primary" disabled={busy || (remote ? !remote.hasModule(tab === "tasks" ? "task" : "note") : false)} onClick={() => {
        // A single recoverable draft must never be silently replaced.
        if (currentDraft) begin(currentDraft);
        else begin({ ...emptyDraft(tab === "tasks" ? "task" : "note"), ...(remote ? { id: crypto.randomUUID() } : {}) });
      }}><Plus size={20} /><span>Создать</span></button>}</div>
      {feedback}
      {remote && tab !== "connection" && <div className="replica-banner"><p>Копия пространства ПК · в очереди {remote.engine.status().pending} · конфликтов {remote.engine.status().conflicts}</p>
        <button disabled={connection.busy} onClick={() => { setTab("connection"); void connection.sync(); }}>Синхронизировать</button></div>}
      {currentDraft && <button className="draft-banner" onClick={() => begin(currentDraft)}><NotebookPen size={20} /><span>Продолжить черновик<strong>{currentDraft.title || "Без названия"}</strong></span></button>}
      {tab === "settings" ? <SettingsPage settings={data.settings} saving={busy} updates={updates}
        backup={() => void backup()} backupBusy={busy}
        save={(settings) => action((value) => value.saveSettings(settings), "Настройки сохранены на этом телефоне")} />
      : tab !== "connection" ? <>
        <label className="search"><Search size={20} /><span className="sr-only">Поиск</span><input type="search" placeholder={tab === "tasks" ? "Найти задачу" : "Найти заметку"} value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        {tab === "notes" && <div className="filters"><button aria-pressed={!archive} onClick={() => setArchive(false)}>Все заметки</button><button aria-pressed={archive} onClick={() => setArchive(true)}><Archive size={16} />Архив</button></div>}
        {tab === "tasks" ? <ul className="entries">{tasks.map((task) => <li key={task.id} className={isTaskClosed(task.status) ? "completed" : ""}>
          <button className="check-button" aria-label={(isTaskClosed(task.status) ? "Вернуть в работу: " : "Завершить: ") + task.title}
            aria-pressed={isTaskClosed(task.status)} disabled={busy} onClick={() => void action((value) => remote ? remote.setTaskDone(task.id, !isTaskClosed(task.status)) : value.setTaskDone(task.id, !isTaskClosed(task.status)), "Задача сохранена")}>
            {isTaskClosed(task.status) && <Check size={19} />}</button>
          <button className="entry-main" onClick={() => currentDraft ? begin(currentDraft) : editTask(task)}><strong>{task.title}</strong>
            {task.description && <span className="excerpt">{task.description}</span>}
            <small>{isTaskClosed(task.status) ? "Завершена" : task.priority === "high" ? "Высокий приоритет" : task.priority === "low" ? "Низкий приоритет" : "К выполнению"}</small></button>
        </li>)}</ul> : <ul className="entries notes">{notes.map((note) => <li key={note.id}>
          <button className="entry-main" onClick={() => currentDraft ? begin(currentDraft) : editNote(note)}><strong>{note.title}</strong>
            <span className="excerpt">{note.body || "Пока только название"}</span><small>{new Date(note.updatedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</small></button>
          <button className="icon-button" aria-label={(archive ? "Вернуть из архива: " : "В архив: ") + note.title} disabled={busy}
            onClick={() => void action((value) => remote ? remote.archiveNote(note.id, !archive) : value.archiveNote(note.id, !archive), archive ? "Заметка возвращена" : "Заметка в архиве — её можно вернуть")}>{archive ? <RotateCcw size={20} /> : <Archive size={20} />}</button>
        </li>)}</ul>}
        {(tab === "tasks" ? tasks : notes).length === 0 && <section className="empty">
          {tab === "tasks" ? <ListTodo size={36} /> : <NotebookPen size={36} />}
          <h2>{query ? "Ничего не найдено" : archive && tab === "notes" ? "Архив пока пуст" : tab === "tasks" ? "Место для первого дела" : "Место для вашей мысли"}</h2>
          <p>{query ? "Попробуйте другое слово или очистите поиск." : archive && tab === "notes" ? "Здесь будут заметки, которые вы отложили."
            : remote && !remote.hasModule(tab === "tasks" ? "task" : "note") ? "Этот модуль недоступен в пространстве компьютера."
            : remote ? "Создайте запись в локальной копии, затем синхронизируйте её с ПК." : "Нажмите «Создать». Всё сохранится на телефоне, даже в авиарежиме."}</p>
          {query && <button onClick={() => setQuery("")}>Очистить поиск</button>}
        </section>}
      </> : <ConnectionPage data={data} connection={connection} address={address} port={port}
        setAddress={setAddress} setPort={setPort} busy={busy} backup={() => void backup()}
        saveProfile={() => { const result = lanProfileSchema.safeParse({ address, port: Number(port) });
          if (!result.success) { setError(result.error.issues[0]?.message ?? "Проверьте адрес и порт"); return; }
          void action((value) => value.saveLan(result.data), "Профиль сохранён. Подключение пока не выполнялось.");
        }} />}
    </main>
    <nav className="navigation" aria-label="Разделы">{([
      ["tasks", "Задачи", ListTodo], ["notes", "Заметки", NotebookPen], ["connection", "Связь", Link2],
      ["settings", "Настройки", Settings],
    ] as const).map(([value, label, Icon]) => <button key={value} aria-current={tab === value ? "page" : undefined}
      onClick={() => { setTab(value); setQuery(""); setError(""); setNotice(""); }}><span className="nav-icon"><Icon size={23} />{value === "settings" && updates.state?.available && <span className="update-dot" aria-label="Доступно обновление" />}</span><span>{label}</span></button>)}</nav>
  </div>;
}

createRoot(document.getElementById("root")!).render(<App />);
