import type { TaskRecurrence } from "@orion/shared-types";

export const TASK_RECURRENCE_LABEL: Record<TaskRecurrence["freq"], string> = {
  daily: "Каждый день",
  weekly: "Каждую неделю",
  monthly: "Каждый месяц",
  yearly: "Каждый год"
};
