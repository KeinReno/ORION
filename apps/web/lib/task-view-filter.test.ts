import type { Task } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { matchesTaskView } from "./task-view-filter";

const now = new Date(2026, 9, 11, 12);

function task(dueAt: string | null, status: Task["status"] = "todo", priority: Task["priority"] = "normal"): Task {
  return { title: "Проверить счёт", description: "по проекту", projectId: "project-1", dueAt, status, priority } as Task;
}

describe("saved task view filters", () => {
  it("applies overdue and week dates in local time without closed tasks", () => {
    const late = task(new Date(2026, 9, 9, 10).toISOString());
    const nextWeek = task(new Date(2026, 9, 12, 10).toISOString());
    expect(matchesTaskView(late, { due: "overdue" }, now)).toBe(true);
    expect(matchesTaskView(late, { due: "week" }, now)).toBe(true);
    expect(matchesTaskView(nextWeek, { due: "week" }, now)).toBe(false);
    expect(matchesTaskView(task(late.dueAt, "done"), { due: "overdue" }, now)).toBe(false);
  });

  it("restores status, priority, project and search together", () => {
    const match = task(null, "in_progress", "high");
    const filters = {
      statuses: ["in_progress" as const], priorities: ["high" as const], projectId: "project-1", search: "счёт", due: "none" as const
    };
    expect(matchesTaskView(match, filters, now)).toBe(true);
    expect(matchesTaskView(task(null, "todo", "high"), filters, now)).toBe(false);
    expect(matchesTaskView(task(null, "in_progress", "normal"), filters, now)).toBe(false);
  });
});
