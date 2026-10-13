import type { Task } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { dailyFlow, flowTotals, workload } from "./dashboard-stats";

const NOW = new Date(2026, 9, 13, 15, 0); // 13 Oct 2026, local
const at = (day: number, hour = 12): string => new Date(2026, 9, day, hour).toISOString();

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    revision: 1,
    workspaceId: "ws",
    projectId: null,
    parentId: null,
    title: id,
    description: "",
    status: "todo",
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
    createdAt: at(1),
    updatedAt: at(1),
    ...patch
  };
}

describe("dailyFlow", () => {
  it("returns exactly `days` entries ending today and counts created / completed per local day", () => {
    const flow = dailyFlow(
      [
        task("a", { createdAt: at(13, 9) }),
        task("b", { createdAt: at(13, 20), status: "done", completedAt: at(13, 21) }),
        task("c", { createdAt: at(12), status: "done", completedAt: at(13) }),
        task("old", { createdAt: new Date(2026, 8, 1).toISOString() })
      ],
      NOW,
      14
    );
    expect(flow).toHaveLength(14);
    expect(flow[13].key).toBe("2026-10-13");
    expect(flow[13]).toMatchObject({ created: 2, completed: 2 });
    expect(flow[12]).toMatchObject({ created: 1, completed: 0 });
    expect(flowTotals(flow)).toEqual({ created: 3, completed: 2, net: 1 });
  });

  it("a canceled task is not 'completed'", () => {
    const flow = dailyFlow([task("x", { createdAt: at(13), status: "canceled", completedAt: at(13) })], NOW, 3);
    expect(flow[2].completed).toBe(0);
  });
});

describe("workload", () => {
  it("splits open tasks into overdue / today / this week and ignores closed ones", () => {
    const result = workload(
      [
        task("overdue", { dueAt: at(10) }),
        task("today", { dueAt: at(13, 23) }),
        task("soon", { dueAt: at(18), status: "in_progress" }),
        task("later", { dueAt: at(30) }),
        task("blocked", { blocked: true }),
        task("done", { status: "done", dueAt: at(1) })
      ],
      NOW
    );
    expect(result).toEqual({ open: 5, inProgress: 1, blocked: 1, overdue: 1, dueToday: 1, dueWeek: 1 });
  });
});
