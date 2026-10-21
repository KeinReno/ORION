import type { ReactNode } from "react";
import { Check, ListTodo, Search } from "lucide-react";
import { isTaskClosed, type Task } from "@orion/shared-types";
import { DepthCard } from "../../depth-card";
import { TaskList } from "../../task-list";
export interface TasksScreenProps {
  tasks: Task[]; busy: boolean; query: string; setQuery: (value: string) => void;
  remote: boolean; available: boolean; edit: (task: Task) => void;
  done: (task: Task) => void; reorder: (ids: string[]) => Promise<boolean>;
  menu: (task: Task) => ReactNode; actions: (task: Task) => ReactNode;
}
export function TasksScreen({ tasks, busy, query, setQuery, remote, available, edit, done, reorder, menu, actions }: TasksScreenProps) {
  return <>
    <DepthCard><label className="search"><Search size={20} /><span className="sr-only">Поиск</span><input type="search" placeholder="Найти задачу" value={query} onChange={(event) => setQuery(event.target.value)} /></label></DepthCard>
    {available && <TaskList tasks={tasks} disabled={busy || Boolean(query)} reorder={reorder} actions={actions}>{(task) => <>
      <button className="check-button" aria-label={(isTaskClosed(task.status) ? "Вернуть в работу: " : "Завершить: ") + task.title} aria-pressed={isTaskClosed(task.status)} disabled={busy} onClick={() => done(task)}>{isTaskClosed(task.status) && <Check size={19} />}</button>
      <button className="entry-main" onClick={() => edit(task)}><strong>{task.title}</strong>{task.description && <span className="excerpt">{task.description}</span>}<small>{isTaskClosed(task.status) ? "Завершена" : task.priority === "high" ? "Высокий приоритет" : task.priority === "low" ? "Низкий приоритет" : "К выполнению"}</small></button>{menu(task)}
    </>}</TaskList>}
    {(!tasks.length || !available) && <DepthCard><section className="empty"><ListTodo size={36} /><h2>{!available ? "Модуль недоступен" : query ? "Ничего не найдено" : "Место для первого дела"}</h2>
      <p>{!available ? "Этот модуль недоступен в пространстве компьютера." : query ? "Попробуйте другое слово или очистите поиск." : remote ? "Создайте запись в локальной копии, затем синхронизируйте её с ПК." : "Нажмите «Создать». Всё сохранится на телефоне, даже в авиарежиме."}</p>
      {query && <button onClick={() => setQuery("")}>Очистить поиск</button>}</section></DepthCard>}
  </>;
}
