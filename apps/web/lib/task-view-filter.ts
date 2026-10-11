import type { Task, TaskViewFilters } from "@orion/shared-types";
import { isTaskClosed } from "@orion/shared-types";

export function matchesTaskView(task: Task, filters: TaskViewFilters, now = new Date()): boolean {
  if (filters.statuses?.length && !filters.statuses.includes(task.status)) return false;
  if (filters.priorities?.length && !filters.priorities.includes(task.priority)) return false;
  if (filters.projectId && task.projectId !== filters.projectId) return false;
  const search = filters.search?.trim().toLocaleLowerCase("ru");
  if (search && !`${task.title} ${task.description}`.toLocaleLowerCase("ru").includes(search)) return false;

  const due = filters.due ?? "all";
  if (due === "all") return true;
  if (due === "none") return task.dueAt === null;
  if (!task.dueAt || isTaskClosed(task.status)) return false;

  const date = new Date(task.dueAt);
  if (due === "overdue") return date.getTime() < now.getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (due === "today") {
    return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  }
  // Week is the current calendar week, Monday through Sunday, in the user's local time.
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  return date >= monday && date < nextMonday;
}
