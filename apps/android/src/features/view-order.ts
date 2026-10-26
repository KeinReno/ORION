import { isTaskClosed, type Task, type Note } from "@orion/shared-types";
export type TaskSort = "manual" | "due" | "priority" | "title";
export type NoteSort = "updated" | "created" | "title";
export function orderTasks(tasks: Task[], order: TaskSort) {
  if (order === "manual") return tasks;
  const priority = { high: 0, normal: 1, low: 2 };
  return [...tasks].sort((a,b) => Number(isTaskClosed(a.status))-Number(isTaskClosed(b.status)) ||
    (order === "due" ? (a.dueAt ? Date.parse(a.dueAt) : Number.MAX_SAFE_INTEGER) - (b.dueAt ? Date.parse(b.dueAt) : Number.MAX_SAFE_INTEGER)
      : order === "priority" ? priority[a.priority]-priority[b.priority] : a.title.localeCompare(b.title,"ru")) || a.id.localeCompare(b.id));
}
export function orderNotes(notes: Note[], order: NoteSort) {
  return [...notes].sort((a,b) => Number(Boolean(b.pinnedAt))-Number(Boolean(a.pinnedAt)) ||
    (order === "title" ? a.title.localeCompare(b.title,"ru") : order === "created" ? b.createdAt.localeCompare(a.createdAt) : (b.editedAt ?? b.updatedAt).localeCompare(a.editedAt ?? a.updatedAt)) || a.id.localeCompare(b.id));
}
