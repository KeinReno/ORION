import { useEffect, useState, type ReactNode } from "react";
import { Check, ListTodo, Search } from "lucide-react";
import { isTaskClosed, type Task } from "@orion/shared-types";
import { filterTasks, EMPTY_TASK_FILTERS, type TaskFilters } from "./task-filters";
import { orderTasks, type TaskSort } from "../view-order";
import { STATUS_LABELS } from "../entry-fields";
import { DepthCard } from "../../depth-card";
import { TaskList } from "../../task-list";
export interface TasksScreenProps {
  sort: TaskSort; setSort: (value: TaskSort) => void;
  filters: TaskFilters; setFilters: (value: TaskFilters) => void;
  tasks: Task[]; checklist: ReadonlyMap<string, Task[]>; busy: boolean; query: string; setQuery: (value: string) => void;
  remote: boolean; available: boolean; edit: (task: Task) => void;
  done: (task: Task) => void; reorder: (ids: string[]) => Promise<boolean>;
  menu: (task: Task) => ReactNode; actions: (task: Task) => ReactNode;
}
export function TasksScreen({ sort, setSort, filters, setFilters, tasks: allTasks, checklist, busy, query, setQuery, remote, available, edit, done, reorder, menu, actions }: TasksScreenProps) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const tick = () => setNow(Date.now()); const timer = setInterval(tick, 60_000); window.addEventListener("focus", tick); document.addEventListener("visibilitychange", tick); return () => { clearInterval(timer); window.removeEventListener("focus", tick); document.removeEventListener("visibilitychange", tick); }; }, []);
  const tasks = orderTasks(filterTasks(allTasks, filters, now), sort);
  const filtered = Object.values(filters).some((value) => value !== "all");
  const checklistLabel = (task: Task) => {
    const items = checklist.get(task.id) ?? [];
    return items.length ? ` · Чек-лист ${items.filter((item) => isTaskClosed(item.status)).length}/${items.length}` : "";
  };
  return <>
    <DepthCard><label className="search"><Search size={20} /><span className="sr-only">Поиск</span><input type="search" placeholder="Найти задачу" value={query} onChange={(event) => setQuery(event.target.value)} /></label></DepthCard>
    <DepthCard><div className="module-filters">
      <label>Порядок задач<select aria-label="Порядок задач" value={sort} onChange={(e) => setSort(e.target.value as TaskSort)}><option value="manual">Вручную</option><option value="due">По сроку</option><option value="priority">По приоритету</option><option value="title">По названию</option></select></label>
      <label>Статус задач<select aria-label="Статус задач" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="all">Все статусы</option><option value="active">Незавершённые</option><option value="closed">Закрытые</option>{Object.entries(STATUS_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Приоритет задач<select aria-label="Приоритет задач" value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}><option value="all">Любой</option><option value="high">Высокий</option><option value="normal">Обычный</option><option value="low">Низкий</option></select></label>
      <label>Срок задач<select aria-label="Срок задач" value={filters.due} onChange={(e) => setFilters({ ...filters, due: e.target.value })}><option value="all">Любой срок</option><option value="today">Сегодня</option><option value="overdue">Просроченные</option><option value="week">Ближайшие 7 дней</option><option value="none">Без срока</option></select></label>
      {filtered && <button className="text-button" onClick={() => setFilters({ ...EMPTY_TASK_FILTERS })}>Сбросить фильтры задач</button>}
      <p className="helper" role="status">Показано: {tasks.length}. {filtered || sort !== "manual" ? "Для перестановки выберите порядок вручную, сбросьте фильтры и поиск." : ""}</p>
    </div></DepthCard>
    {available && <TaskList tasks={tasks} disabled={busy || Boolean(query) || filtered || sort !== "manual"} reorder={reorder} actions={actions}>{(task) => <>
      <button className="check-button" aria-label={(isTaskClosed(task.status) ? "Вернуть в работу: " : "Завершить: ") + task.title} aria-pressed={isTaskClosed(task.status)} disabled={busy} onClick={() => done(task)}>{isTaskClosed(task.status) && <Check size={19} />}</button>
      <button className="entry-main" onClick={() => edit(task)}><strong>{task.title}</strong>{task.description && <span className="excerpt">{task.description}</span>}<small>{STATUS_LABELS[task.status]}{task.priority === "high" ? " · Высокий приоритет" : task.priority === "low" ? " · Низкий приоритет" : ""}{task.dueAt ? ` · До ${new Date(task.dueAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}{task.estimatedMinutes !== null ? ` · План: ${task.estimatedMinutes} мин` : ""}{!isTaskClosed(task.status) && task.dueAt && Date.parse(task.dueAt) < now ? " · Просрочена" : ""}{checklistLabel(task)}</small></button>{menu(task)}
    </>}</TaskList>}
    {(!tasks.length || !available) && <DepthCard><section className="empty"><ListTodo size={36} /><h2>{!available ? "Модуль недоступен" : query || filtered ? "Ничего не найдено" : "Место для первого дела"}</h2>
      <p>{!available ? "Этот модуль недоступен в пространстве компьютера." : query || filtered ? "Измените фильтры или очистите поиск." : remote ? "Создайте запись в локальной копии, затем синхронизируйте её с ПК." : "Нажмите «Создать». Всё сохранится на телефоне, даже в авиарежиме."}</p>
      {query && <button onClick={() => setQuery("")}>Очистить поиск</button>}</section></DepthCard>}
  </>;
}
