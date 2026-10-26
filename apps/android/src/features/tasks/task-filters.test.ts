import { describe, expect, it } from "vitest";
import type { Task } from "@orion/shared-types";
import { filterTasks, EMPTY_TASK_FILTERS } from "./task-filters";
describe("task date filters", () => {
  it("uses local day boundaries, excludes closed overdue tasks and combines filters", () => {
    const now = new Date(2026,9,21,12).getTime();
    const task = (id: string, status: Task["status"], dueAt: string | null, priority: Task["priority"] = "normal") => ({ id, status, dueAt, priority } as Task);
    const tasks = [task("late","todo",new Date(now-3600000).toISOString(),"high"),task("done","done",new Date(now-3600000).toISOString()),task("canceled","canceled",new Date(now-3600000).toISOString()),task("none","todo",null),task("tomorrow","in_progress",new Date(2026,9,22,9).toISOString()),task("midnight","todo",new Date(2026,9,22,0).toISOString())];
    expect(filterTasks(tasks,{ ...EMPTY_TASK_FILTERS, due: "overdue" },now).map(t => t.id)).toEqual(["late"]);
    expect(filterTasks(tasks,{ ...EMPTY_TASK_FILTERS, due: "today" },now).map(t => t.id)).toEqual(["late"]);
    expect(filterTasks(tasks,{ ...EMPTY_TASK_FILTERS, status: "closed" },now)).toHaveLength(2);
    expect(filterTasks(tasks,{ ...EMPTY_TASK_FILTERS, priority: "high", due: "today" },now)).toHaveLength(1);
    expect(filterTasks(tasks,{ ...EMPTY_TASK_FILTERS, due: "none" },now).map(t => t.id)).toEqual(["none"]);
    expect(filterTasks(tasks,{ ...EMPTY_TASK_FILTERS, status: "in_progress", due: "week" },now).map(t => t.id)).toEqual(["tomorrow"]);
  });
});
