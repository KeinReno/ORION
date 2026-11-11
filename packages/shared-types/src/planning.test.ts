import { describe, expect, it } from "vitest";
import {
  computeCriticalPath,
  intervalsOverlap,
  isoWeekKey,
  isoWeekRange,
  matrixAxisValue,
  overlapMinutes,
  planReschedule,
  quadrantFor,
  quadrantTargets,
  urgencyFromDueAt,
  type CpmTaskInput,
  type ImpactTaskInput
} from "./planning";

/**
 * Чистые расчёты планирования. Здесь важно, что ожидания посчитаны РУКАМИ, а не
 * сняты с вывода функции: CPM — стандартный алгоритм, и эталонный граф ниже
 * расписан по шагам в комментариях.
 */

/** `HH:MM` в UTC от начала дня — короткая запись окон в фикстурах. */
function at(hours: number, minutes = 0): string {
  return new Date(Date.UTC(2026, 0, 5, hours, minutes)).toISOString();
}

describe("computeCriticalPath (CPM)", () => {
  /**
   * Эталонный граф из 8 задач с ветвлением (критерий приёмки 1 задания 04):
   *
   *   A(60) ─┬─ B(120) ─ D(60) ─┐
   *          └─ C(30)  ─ E(90) ─┴─ G(30)
   *   F(45) ─ H(60)                    (независимая ветка)
   *
   * Прямой проход (ES/EF, минуты): A 0/60, B 60/180, C 60/90, D 180/240,
   * E 90/180, F 0/45, G 240/270, H 45/105. Финиш проекта — 270.
   * Обратный: LS/float: A 0/0, B 60/0, C 120/60, D 180/0, E 150/60,
   * F 150/150, G 240/0, H 210/165. Критический путь — A → B → D → G.
   */
  const graph: CpmTaskInput[] = [
    { id: "A", startAt: at(0), dueAt: at(1), estimatedMinutes: null, dependsOn: [] },
    { id: "B", startAt: at(1), dueAt: at(3), estimatedMinutes: null, dependsOn: ["A"] },
    { id: "C", startAt: at(1), dueAt: at(1, 30), estimatedMinutes: null, dependsOn: ["A"] },
    { id: "D", startAt: at(3), dueAt: at(4), estimatedMinutes: null, dependsOn: ["B"] },
    { id: "E", startAt: at(1, 30), dueAt: at(3), estimatedMinutes: null, dependsOn: ["C"] },
    { id: "F", startAt: at(0), dueAt: at(0, 45), estimatedMinutes: null, dependsOn: [] },
    { id: "G", startAt: at(4), dueAt: at(4, 30), estimatedMinutes: null, dependsOn: ["D", "E"] },
    { id: "H", startAt: at(0, 45), dueAt: at(1, 45), estimatedMinutes: null, dependsOn: ["F"] }
  ];

  it("returns the hand-computed critical path and total float for the 8-task fixture", () => {
    const result = computeCriticalPath(graph);
    expect(result.finishMinutes).toBe(270);
    expect(result.criticalPath).toEqual(["A", "B", "D", "G"]);
    expect(result.cycles).toEqual([]);
    expect(result.unscheduled).toEqual([]);

    const floats = Object.fromEntries(Object.entries(result.tasks).map(([id, node]) => [id, node.totalFloatMinutes]));
    expect(floats).toEqual({ A: 0, B: 0, C: 60, D: 0, E: 60, F: 165, G: 0, H: 165 });

    expect(result.tasks.A).toMatchObject({ earliestStartMinutes: 0, earliestFinishMinutes: 60, latestStartMinutes: 0 });
    expect(result.tasks.B).toMatchObject({ earliestStartMinutes: 60, earliestFinishMinutes: 180 });
    expect(result.tasks.G).toMatchObject({ earliestStartMinutes: 240, earliestFinishMinutes: 270, latestStartMinutes: 240 });
    expect(result.tasks.H!.critical).toBe(false);
  });

  it("takes duration from the estimate when the task has no dates", () => {
    const result = computeCriticalPath([
      { id: "A", startAt: null, dueAt: null, estimatedMinutes: 90, dependsOn: [] },
      { id: "B", startAt: null, dueAt: null, estimatedMinutes: 30, dependsOn: ["A"] }
    ]);
    expect(result.finishMinutes).toBe(120);
    expect(result.criticalPath).toEqual(["A", "B"]);
  });

  it("keeps a dated task without duration as a zero-length point instead of dropping the edge", () => {
    const result = computeCriticalPath([
      { id: "A", startAt: null, dueAt: null, estimatedMinutes: 60, dependsOn: [] },
      { id: "milestone", startAt: at(2), dueAt: null, estimatedMinutes: null, dependsOn: ["A"] },
      { id: "B", startAt: null, dueAt: null, estimatedMinutes: 30, dependsOn: ["milestone"] }
    ]);
    expect(result.tasks.milestone?.durationMinutes).toBe(0);
    expect(result.finishMinutes).toBe(90);
    expect(result.criticalPath).toEqual(["A", "milestone", "B"]);
  });

  it("reports tasks without dates or estimate as unscheduled, not as zero-duration", () => {
    const result = computeCriticalPath([
      { id: "A", startAt: null, dueAt: null, estimatedMinutes: 60, dependsOn: [] },
      { id: "floating", startAt: null, dueAt: null, estimatedMinutes: null, dependsOn: ["A"] }
    ]);
    expect(result.unscheduled).toEqual(["floating"]);
    expect(result.tasks.floating).toBeUndefined();
    expect(result.finishMinutes).toBe(60);
  });

  it("isolates a dependency cycle instead of hanging or inventing a path", () => {
    const result = computeCriticalPath([
      { id: "A", startAt: at(0), dueAt: at(1), estimatedMinutes: null, dependsOn: ["B"] },
      { id: "B", startAt: at(1), dueAt: at(2), estimatedMinutes: null, dependsOn: ["A"] },
      { id: "C", startAt: at(0), dueAt: at(0, 30), estimatedMinutes: null, dependsOn: [] }
    ]);
    expect(result.cycles).toEqual(["A", "B"]);
    expect(result.criticalPath).toEqual(["C"]);
    expect(result.finishMinutes).toBe(30);
  });
});

describe("planReschedule (dry-run impact)", () => {
  /** A → B → C по finish-to-start; D зависит от A, но без дат. */
  const tasks: ImpactTaskInput[] = [
    { id: "A", title: "A", startAt: at(10), dueAt: at(11), dependsOn: [], milestoneId: "M1" },
    { id: "B", title: "B", startAt: at(11), dueAt: at(12), dependsOn: ["A"], milestoneId: "M1" },
    { id: "C", title: "C", startAt: at(12), dueAt: at(13), dependsOn: ["B"], milestoneId: null },
    { id: "D", title: "D", startAt: null, dueAt: null, dependsOn: ["A"], milestoneId: null }
  ];

  it("pushes the whole dependent chain by the shift and leaves undated tasks alone", () => {
    const plan = planReschedule({ tasks, movedTaskId: "A", newDueAt: at(12) });
    expect(plan).not.toBeNull();
    expect(plan!.task.shiftMinutes).toBe(60);
    expect(plan!.tasks.map((task) => [task.id, task.shiftMinutes])).toEqual([
      ["B", 60],
      ["C", 60]
    ]);
    expect(plan!.tasks.find((task) => task.id === "B")?.nextStartAt).toBe(at(12));
    expect(plan!.tasks.find((task) => task.id === "B")?.nextDueAt).toBe(at(13));
    // D без дат не сдвигается: сдвигать нечего.
    expect(plan!.tasks.find((task) => task.id === "D")).toBeUndefined();
    // Веха M1 двигается на максимальный сдвиг своих задач.
    expect(plan!.milestones).toEqual([{ id: "M1", affectedTaskIds: ["B"], shiftMinutes: 60 }]);
  });

  it("does not move anything when the new date keeps the dependency order", () => {
    const plan = planReschedule({ tasks, movedTaskId: "A", newDueAt: at(10, 30) });
    expect(plan!.task.shiftMinutes).toBe(-30);
    expect(plan!.tasks).toEqual([]);
  });

  it("returns null for an unknown task", () => {
    expect(planReschedule({ tasks, movedTaskId: "nope", newDueAt: at(12) })).toBeNull();
  });
});

describe("matrix axes and quadrants", () => {
  it("falls back to priority while the explicit importance field is empty, and says so", () => {
    const value = matrixAxisValue(
      { field: "importance", kind: "importance" },
      { priority: "high", status: "todo", dueAt: null, importance: null }
    );
    expect(value).toEqual({ value: 3, high: true, source: "priority" });

    const low = matrixAxisValue(
      { field: "importance", kind: "importance" },
      { priority: "low", status: "todo", dueAt: null }
    );
    expect(low).toMatchObject({ high: false, source: "priority" });
  });

  it("prefers the explicit task field once it is set", () => {
    const value = matrixAxisValue(
      { field: "importance", kind: "importance" },
      { priority: "low", status: "todo", dueAt: null, importance: 3 }
    );
    expect(value).toEqual({ value: 3, high: true, source: "field" });
  });

  it("derives urgency from the due date and never marks a passed deadline as relaxed", () => {
    const now = new Date(Date.UTC(2026, 0, 5, 12, 0));
    expect(urgencyFromDueAt(new Date(Date.UTC(2026, 0, 5, 11, 0)).toISOString(), now).value).toBe(3);
    expect(urgencyFromDueAt(new Date(Date.UTC(2026, 0, 6, 6, 0)).toISOString(), now).value).toBe(2);
    expect(urgencyFromDueAt(new Date(Date.UTC(2026, 0, 7, 6, 0)).toISOString(), now).value).toBe(1);
    expect(urgencyFromDueAt(new Date(Date.UTC(2026, 1, 1)).toISOString(), now).value).toBe(0);
    expect(urgencyFromDueAt(null, now).value).toBe(0);
  });

  it("maps axis values to quadrants and back", () => {
    for (const quadrant of ["q1", "q2", "q3", "q4"] as const) {
      const targets = quadrantTargets(quadrant);
      expect(quadrantFor(targets.x, targets.y)).toBe(quadrant);
    }
  });

  it("reads a numeric custom field, and reports none when the value is missing", () => {
    const axis = { field: "f-1", kind: "customFieldId" as const };
    expect(
      matrixAxisValue(axis, { priority: "normal", status: "todo", dueAt: null, customFields: { "f-1": 3 } })
    ).toEqual({ value: 3, high: true, source: "customField" });
    expect(matrixAxisValue(axis, { priority: "normal", status: "todo", dueAt: null, customFields: {} })).toMatchObject({
      value: 0,
      high: false,
      source: "none"
    });
  });
});

describe("intervals", () => {
  it("treats touching intervals as non-overlapping and measures real overlaps in minutes", () => {
    expect(intervalsOverlap("2026-01-05T10:00:00Z", "2026-01-05T11:00:00Z", "2026-01-05T11:00:00Z", "2026-01-05T12:00:00Z")).toBe(false);
    expect(overlapMinutes("2026-01-05T10:00:00Z", "2026-01-05T11:30:00Z", "2026-01-05T11:00:00Z", "2026-01-05T12:00:00Z")).toBe(30);
    expect(overlapMinutes("2026-01-05T10:00:00Z", "2026-01-05T11:00:00Z", "2026-01-05T10:00:00Z", "2026-01-05T11:00:00Z")).toBe(60);
    expect(overlapMinutes("2026-01-05T10:00:00Z", "2026-01-05T11:00:00Z", "2026-01-05T12:00:00Z", "2026-01-05T13:00:00Z")).toBe(0);
  });
});

describe("ISO week keys", () => {
  it("uses the ISO week that owns the Thursday of that week", () => {
    expect(isoWeekKey(new Date("2026-01-01T12:00:00Z"))).toBe("2026-W01");
    expect(isoWeekKey(new Date("2026-11-11T12:00:00Z"))).toBe("2026-W46");
    expect(isoWeekKey(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
    expect(isoWeekKey(new Date("2024-12-30T12:00:00Z"))).toBe("2025-W01");
  });

  it("turns a week key back into its Monday..next-Monday range", () => {
    const { from, to } = isoWeekRange("2026-W46");
    expect(from.toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(isoWeekKey(from)).toBe("2026-W46");
  });
});
