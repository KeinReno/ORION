import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays, Check, CircleDashed, ListTodo } from "lucide-react";
import { isTaskClosed, type Task } from "@orion/shared-types";
import { filterTasks, EMPTY_TASK_FILTERS, type TaskFilters } from "./task-filters";
import { orderTasks, type TaskSort } from "../view-order";
import { STATUS_LABELS } from "../entry-fields";
import { DepthCard } from "../../depth-card";
import { ModuleSearch } from "../module-search";
import { ModuleFilters } from "../module-filters";
import { TaskList } from "../../task-list";
export interface TasksScreenProps {
  sort: TaskSort; setSort: (value: TaskSort) => void;
  filters: TaskFilters; setFilters: (value: TaskFilters) => void;
  tasks: Task[]; checklist: ReadonlyMap<string, Task[]>; busy: boolean; query: string; setQuery: (value: string) => void;
  remote: boolean; available: boolean; edit: (task: Task) => void;
  done: (task: Task) => void; reorder: (ids: string[]) => Promise<boolean>;
  menu: (task: Task) => ReactNode; actions: (task: Task) => ReactNode;
  gestureEnabled: boolean; swipeDelete: (task: Task) => void;
}
export function TasksScreen({ sort, setSort, filters, setFilters, tasks: allTasks, checklist, busy, query, setQuery, remote, available, edit, done, reorder, menu, actions, gestureEnabled, swipeDelete }: TasksScreenProps) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const tick = () => setNow(Date.now()); const timer = setInterval(tick, 60_000); window.addEventListener("focus", tick); document.addEventListener("visibilitychange", tick); return () => { clearInterval(timer); window.removeEventListener("focus", tick); document.removeEventListener("visibilitychange", tick); }; }, []);
  const tasks = orderTasks(filterTasks(allTasks, filters, now), sort);
  const filtered = Object.values(filters).some((value) => value !== "all");
  const checklistLabel = (task: Task) => {
    const items = checklist.get(task.id) ?? [];
    return items.length ? ` · Чек-лист ${items.filter((item) => isTaskClosed(item.status)).length}/${items.length}` : "";
  };
  return <>
    <ModuleSearch placeholder="Найти задачу" query={query} setQuery={setQuery} />
    <div className="view-presets" role="group" aria-label="Быстрые фильтры задач">
      <button aria-pressed={!filtered} onClick={() => setFilters({ ...EMPTY_TASK_FILTERS })}><ListTodo size={16} aria-hidden="true" />Все</button>
      <button aria-pressed={filters.status === "active" && filters.due === "all" && filters.priority === "all"} onClick={() => setFilters({ ...EMPTY_TASK_FILTERS, status: "active" })}><CircleDashed size={16} aria-hidden="true" />Открытые</button>
      <button aria-pressed={filters.due === "today" && filters.status === "all" && filters.priority === "all"} onClick={() => setFilters({ ...EMPTY_TASK_FILTERS, due: "today" })}><CalendarDays size={16} aria-hidden="true" />Сегодня</button>
    </div>
    <DepthCard><ModuleFilters name="Фильтры задач" active={Object.values(filters).filter((value) => value !== "all").length + Number(sort !== "manual")} >
      <label>Порядок задач<select aria-label="Порядок задач" value={sort} onChange={(e) => setSort(e.target.value as TaskSort)}><option value="manual">Вручную</option><option value="due">По сроку</option><option value="priority">По приоритету</option><option value="title">По названию</option></select></label>
      <label>Статус задач<select aria-label="Статус задач" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="all">Все статусы</option><option value="active">Незавершённые</option><option value="closed">Закрытые</option>{Object.entries(STATUS_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Приоритет задач<select aria-label="Приоритет задач" value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}><option value="all">Любой</option><option value="high">Высокий</option><option value="normal">Обычный</option><option value="low">Низкий</option></select></label>
      <label>Срок задач<select aria-label="Срок задач" value={filters.due} onChange={(e) => setFilters({ ...filters, due: e.target.value })}><option value="all">Любой срок</option><option value="today">Сегодня</option><option value="overdue">Просроченные</option><option value="week">Ближайшие 7 дней</option><option value="none">Без срока</option></select></label>
    </ModuleFilters></DepthCard>
    <div className="results-line"><p role="status">Показано: {tasks.length}</p>{filtered && <button className="text-button" onClick={() => setFilters({ ...EMPTY_TASK_FILTERS })}>Сбросить фильтры задач</button>}</div>
    {(filtered || sort !== "manual" || query) && tasks.length > 1 && <p className="helper">Для перестановки выберите порядок вручную, сбросьте фильтры и поиск.</p>}
    {available && <TaskList tasks={tasks} disabled={busy || Boolean(query) || filtered || sort !== "manual"} reorder={reorder} actions={actions} gestureEnabled={gestureEnabled && !busy} swipeRight={done} swipeLeft={swipeDelete}>{(task) => <>
      <button className="check-button" aria-label={(isTaskClosed(task.status) ? "Вернуть в работу: " : "Завершить: ") + task.title} aria-pressed={isTaskClosed(task.status)} disabled={busy} onClick={() => done(task)}>{isTaskClosed(task.status) && <Check size={19} />}</button>
      <button className="entry-main" onClick={() => edit(task)}><strong>{task.title}</strong>{task.description && <span className="excerpt">{task.description}</span>}<small className="entry-status">{STATUS_LABELS[task.status]}{checklistLabel(task)}</small>
        <span className="entry-badges">{task.priority !== "normal" && <span className={task.priority === "high" ? "entry-badge important" : "entry-badge"}>{task.priority === "high" ? "Высокий приоритет" : "Низкий приоритет"}</span>}
          {task.dueAt && <span className={!isTaskClosed(task.status) && Date.parse(task.dueAt) < now ? "entry-badge overdue" : "entry-badge"}>{!isTaskClosed(task.status) && Date.parse(task.dueAt) < now ? "Просрочена · " : "До "}{new Date(task.dueAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
          {task.estimatedMinutes !== null && <span className="entry-badge">План: {task.estimatedMinutes} мин</span>}
        </span></button>{menu(task)}
    </>}</TaskList>}
    {(!tasks.length || !available) && <DepthCard><section className="empty"><ListTodo size={36} /><h2>{!available ? "Модуль недоступен" : query || filtered ? "Ничего не найдено" : "Место для первого дела"}</h2>
      <p>{!available ? "Этот модуль недоступен в пространстве компьютера." : query || filtered ? "Измените фильтры или очистите поиск." : remote ? "Создайте запись в локальной копии, затем синхронизируйте её с ПК." : "Нажмите «+» в заголовке. Всё сохранится на телефоне, даже в авиарежиме."}</p>
      {available && (query || filtered) && <button onClick={() => { setQuery(""); setFilters({ ...EMPTY_TASK_FILTERS }); }}>Показать все задачи</button>}</section></DepthCard>}
  </>;
}

