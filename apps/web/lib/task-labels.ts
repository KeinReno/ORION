import type { TaskPriority, TaskRecurrence, TaskStatus } from "@orion/shared-types";

export const TASK_RECURRENCE_LABEL: Record<TaskRecurrence["freq"], string> = {
  daily: "Каждый день",
  weekly: "Каждую неделю",
  monthly: "Каждый месяц",
  yearly: "Каждый год"
};

/**
 * Board columns and select order. `backlog`/`canceled` joined the contract in
 * v0.14 (PLAN) — backlog sorts first (nothing decided yet), canceled sits after
 * `done`. "Is it still open" is decided by `isTaskClosed` from
 * `@orion/shared-types`, not by a local copy of the rule.
 */
export const TASK_STATUS_ORDER: TaskStatus[] = ["backlog", "todo", "in_progress", "done", "canceled"];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Бэклог",
  todo: "К выполнению",
  in_progress: "В работе",
  done: "Готово",
  canceled: "Отменено"
};

/** High-to-low — the order that reads naturally in a priority column/select. */
export const TASK_PRIORITY_ORDER: TaskPriority[] = ["high", "normal", "low"];
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  high: "Высокий",
  normal: "Обычный",
  low: "Низкий"
};
