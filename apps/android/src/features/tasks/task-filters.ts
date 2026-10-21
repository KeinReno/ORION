import { isTaskClosed, type Task } from "@orion/shared-types";
export interface TaskFilters { status: string; priority: string; due: string }
export const EMPTY_TASK_FILTERS: TaskFilters = { status: "all", priority: "all", due: "all" };
export function filterTasks(tasks: Task[], filters: TaskFilters, now = Date.now()) {
  const end = new Date(now); end.setHours(24,0,0,0);
  const start = new Date(now); start.setHours(0,0,0,0);
  const week = new Date(start); week.setDate(week.getDate()+7);
  return tasks.filter((task) => {
    const closed = isTaskClosed(task.status); const due = task.dueAt ? Date.parse(task.dueAt) : null;
    return (filters.status === "all" || (filters.status === "active" ? !closed : filters.status === "closed" ? closed : task.status === filters.status))
      && (filters.priority === "all" || task.priority === filters.priority)
      && (filters.due === "all" || (filters.due === "none" ? due === null : !closed && due !== null &&
        (filters.due === "overdue" ? due < now : filters.due === "today" ? due >= +start && due < +end : due >= +start && due < +week)));
  });
}
