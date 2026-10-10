import { describe, expect, it } from "vitest";
import { localDayDueAt, localDayRange, localWeekRange, partitionOpenTasks, partitionWeekReview } from "./today";
import type { Task } from "./task";

function task(partial: Partial<Task> & Pick<Task, "id" | "title" | "status">): Task {
  return {
    revision: 1,
    workspaceId: "ws",
    projectId: null,
    parentId: null,
    description: "",
    priority: "normal",
    dueAt: null,
    projectTag: null,
    recurrence: null,
    completedAt: null,
    sortOrder: 0,
    dependencyIds: [],
    blocked: false,
    assigneeId: null,
    startAt: null,
    estimatedMinutes: null,
    milestoneId: null,
    createdAt: "2026-09-15T08:00:00.000Z",
    updatedAt: "2026-09-15T08:00:00.000Z",
    ...partial
  };
}

describe("localDayRange", () => {
  it("covers the local calendar day as a half-open ISO window", () => {
    const now = new Date(2026, 8, 15, 15, 30, 0);
    const range = localDayRange(now);
    expect(new Date(range.from).getTime()).toBe(new Date(2026, 8, 15).getTime());
    expect(new Date(range.to).getTime()).toBe(new Date(2026, 8, 16).getTime());
  });
});

describe("partitionOpenTasks", () => {
  const now = new Date(2026, 8, 15, 15, 0, 0);

  it("keeps overdue, remaining today and upcoming from overlapping", () => {
    const overdueMorning = task({
      id: "1",
      title: "Утро",
      status: "todo",
      dueAt: new Date(2026, 8, 15, 9, 0, 0).toISOString()
    });
    const laterToday = task({
      id: "2",
      title: "Вечер",
      status: "todo",
      dueAt: new Date(2026, 8, 15, 18, 0, 0).toISOString()
    });
    const tomorrow = task({
      id: "3",
      title: "Завтра",
      status: "todo",
      dueAt: new Date(2026, 8, 16, 10, 0, 0).toISOString()
    });
    const done = task({
      id: "4",
      title: "Готово",
      status: "done",
      dueAt: new Date(2026, 8, 15, 8, 0, 0).toISOString()
    });
    const parts = partitionOpenTasks([overdueMorning, laterToday, tomorrow, done], now);
    expect(parts.overdue.map((item) => item.id)).toEqual(["1"]);
    expect(parts.today.map((item) => item.id)).toEqual(["2"]);
    expect(parts.upcoming.map((item) => item.id)).toEqual(["3"]);
  });

  it("puts in-progress and high-priority unblocked tasks into focus first", () => {
    const blocked = task({ id: "b", title: "Блок", status: "todo", priority: "high", blocked: true });
    const high = task({ id: "h", title: "Важно", status: "todo", priority: "high" });
    const running = task({ id: "r", title: "В работе", status: "in_progress", priority: "low" });
    const low = task({ id: "l", title: "Потом", status: "todo", priority: "low" });
    const parts = partitionOpenTasks([blocked, high, running, low], now);
    expect(parts.focus.map((item) => item.id)).toEqual(["r", "h", "l"]);
    expect(parts.focus.some((item) => item.id === "b")).toBe(false);
  });
});

describe("localDayDueAt", () => {
  it("is the last instant of the local day, still same calendar day", () => {
    const now = new Date(2026, 8, 15, 9, 0, 0);
    const due = new Date(localDayDueAt(now));
    expect(due.getFullYear()).toBe(2026);
    expect(due.getMonth()).toBe(8);
    expect(due.getDate()).toBe(15);
    expect(due.getTime()).toBe(new Date(2026, 8, 16).getTime() - 1);
  });
});

describe("localWeekRange", () => {
  it("starts Monday and spans seven local days", () => {
    // 15 Sep 2026 is a Tuesday → week is Mon 14 → Mon 21.
    const range = localWeekRange(new Date(2026, 8, 15, 18, 0, 0));
    expect(new Date(range.from).getTime()).toBe(new Date(2026, 8, 14).getTime());
    expect(new Date(range.to).getTime()).toBe(new Date(2026, 8, 21).getTime());
  });

  it("treats Sunday as the end of the week that started the previous Monday", () => {
    const range = localWeekRange(new Date(2026, 8, 20, 12, 0, 0));
    expect(new Date(range.from).getTime()).toBe(new Date(2026, 8, 14).getTime());
    expect(new Date(range.to).getTime()).toBe(new Date(2026, 8, 21).getTime());
  });
});

describe("partitionWeekReview", () => {
  const now = new Date(2026, 8, 15, 15, 0, 0);

  it("splits completed this week, remaining this week, and carry-over overdue", () => {
    const doneThisWeek = task({
      id: "d",
      title: "Сделано",
      status: "done",
      completedAt: new Date(2026, 8, 14, 11, 0, 0).toISOString()
    });
    const remaining = task({
      id: "r",
      title: "Ещё",
      status: "todo",
      dueAt: new Date(2026, 8, 16, 10, 0, 0).toISOString()
    });
    const carry = task({
      id: "c",
      title: "С прошлой",
      status: "todo",
      dueAt: new Date(2026, 8, 10, 10, 0, 0).toISOString()
    });
    const doneLastWeek = task({
      id: "old",
      title: "Старое",
      status: "done",
      completedAt: new Date(2026, 8, 8, 10, 0, 0).toISOString()
    });
    const parts = partitionWeekReview([doneThisWeek, remaining, carry, doneLastWeek], now);
    expect(parts.completed.map((item) => item.id)).toEqual(["d"]);
    expect(parts.remaining.map((item) => item.id)).toEqual(["r"]);
    expect(parts.overdueBeforeWeek.map((item) => item.id)).toEqual(["c"]);
  });
});
