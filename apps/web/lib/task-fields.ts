import type { Task, TaskChecklistItem, TaskPriority, TaskRecurrence, TaskStatus, UpdateTaskInput } from "@orion/shared-types";
import { fromDatetimeLocal, toDatetimeLocal } from "./format";

/**
 * Editable fields as the inputs hold them (strings for date/number inputs).
 * The detail pane saves by *diffing* these against what the server last
 * acknowledged and sending only the keys that changed — so a status moved on
 * the board while this pane is open is never overwritten by a stale copy of it.
 */
export interface Fields {
  title: string;
  description: string;
  dueAt: string;
  startAt: string;
  projectId: string;
  parentId: string;
  priority: TaskPriority;
  status: TaskStatus;
  recurrenceFreq: TaskRecurrence["freq"] | "";
  recurrenceInterval: string;
  dependencyIds: string[];
  assigneeId: string;
  estimatedHours: string;
  milestoneId: string;
  checklist: TaskChecklistItem[];
}

export function fieldsFromTask(task: Task): Fields {
  return {
    title: task.title,
    description: task.description,
    dueAt: toDatetimeLocal(task.dueAt),
    startAt: toDatetimeLocal(task.startAt),
    projectId: task.projectId ?? "",
    parentId: task.parentId ?? "",
    priority: task.priority,
    status: task.status,
    recurrenceFreq: task.recurrence?.freq ?? "",
    recurrenceInterval: String(task.recurrence?.interval ?? 1),
    dependencyIds: [...task.dependencyIds].sort(),
    assigneeId: task.assigneeId ?? "",
    estimatedHours: task.estimatedMinutes !== null ? String(task.estimatedMinutes / 60) : "",
    milestoneId: task.milestoneId ?? "",
    checklist: (task.checklist ?? []).map((item) => ({ ...item }))
  };
}

export function sameFields(a: Fields, b: Fields): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Only the keys that differ — empty object means nothing to save. */
export function buildPatch(prev: Fields, next: Fields, withAssignee: boolean): UpdateTaskInput {
  const patch: UpdateTaskInput = {};
  const title = next.title.trim();
  if (title && title !== prev.title.trim()) patch.title = title;
  if (next.description !== prev.description) patch.description = next.description;
  if (next.dueAt !== prev.dueAt) patch.dueAt = fromDatetimeLocal(next.dueAt);
  if (next.startAt !== prev.startAt) patch.startAt = fromDatetimeLocal(next.startAt);
  if (next.projectId !== prev.projectId) patch.projectId = next.projectId || null;
  if (next.parentId !== prev.parentId) patch.parentId = next.parentId || null;
  if (next.priority !== prev.priority) patch.priority = next.priority;
  if (next.status !== prev.status) patch.status = next.status;
  if (next.recurrenceFreq !== prev.recurrenceFreq || next.recurrenceInterval !== prev.recurrenceInterval) {
    const interval = Number(next.recurrenceInterval);
    patch.recurrence =
      next.recurrenceFreq === ""
        ? null
        : { freq: next.recurrenceFreq, interval: Number.isFinite(interval) && interval >= 1 ? Math.min(interval, 365) : 1 };
  }
  if (next.dependencyIds.join("|") !== prev.dependencyIds.join("|")) patch.dependencyIds = next.dependencyIds;
  if (withAssignee && next.assigneeId !== prev.assigneeId) patch.assigneeId = next.assigneeId || null;
  if (next.estimatedHours !== prev.estimatedHours) {
    const hours = next.estimatedHours.trim() ? Number(next.estimatedHours) : null;
    patch.estimatedMinutes = hours !== null && Number.isFinite(hours) && hours >= 0 ? Math.round(hours * 60) : null;
  }
  if (next.milestoneId !== prev.milestoneId) patch.milestoneId = next.milestoneId || null;
  const prevList = cleanChecklist(prev.checklist);
  const nextList = cleanChecklist(next.checklist);
  if (JSON.stringify(prevList) !== JSON.stringify(nextList)) patch.checklist = nextList;
  return patch;
}

function cleanChecklist(items: TaskChecklistItem[]): TaskChecklistItem[] {
  return items
    .map((item) => ({ id: item.id, title: item.title.trim(), done: item.done }))
    .filter((item) => item.title.length > 0);
}
