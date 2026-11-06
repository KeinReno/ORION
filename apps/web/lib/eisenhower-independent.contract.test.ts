import { describe, expect, it } from "vitest";
import {
  eisenhowerImportance, eisenhowerUrgency, buildEisenhowerMatrix
} from "./project-matrix";
import type { Task } from "@orion/shared-types";

/**
 * QA-04 RED CONTRACT (beta37): independence of importance/urgency is required.
 *
 * These tests are intentionally not adjusted to the existing legacy mapping:
 *   importance = (priority === "high"), urgency = (dueAt <= 3 days).
 * CORE-01 must choose and document the actual field names / unset semantics.
 * The tests below do NOT assume a particular serialization for either field.
 *
 * All tasks in these tests have UNSET explicit matrix axes. Therefore changing
 * only the unrelated priority or deadline must NOT change their quadrant.
 * This is a real regression assertion, not a test that mocks a matrix engine.
 */
const now = new Date("2026-11-06T12:00:00.000Z");
const dayAfter = "2026-11-07T12:00:00.000Z";

function legacyTask(id: string, priority: "high" | "low", dueAt: string | null): Task {
  return {
    id,
    revision: 1,
    workspaceId: "qa",
    projectId: "qa-project",
    parentId: null,
    title: id,
    description: "",
    status: "todo",
    priority,
    dueAt,
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
    checklist: [],
    createdAt: "2026-11-06T00:00:00.000Z",
    updatedAt: "2026-11-06T00:00:00.000Z"
  };
}

describe("QA-04: matrix axes remain independent from task priority and deadline", () => {
  it("QA-04-01: changing priority alone cannot change importance when importance is unset", () => {
    const high = legacyTask("high", "high", null);
    const low = legacyTask("low", "low", null);
    expect(eisenhowerImportance(high)).toEqual(eisenhowerImportance(low));
  });

  it("QA-04-02: changing dueAt alone cannot change urgency when urgency is unset", () => {
    const dated = legacyTask("dated", "low", dayAfter);
    const undated = legacyTask("undated", "low", null);
    expect(eisenhowerUrgency(dated, now)).toEqual(eisenhowerUrgency(undated, now));
  });

  it("QA-04-03: changing priority or dueAt does not move a task between quadrants", () => {
    const before = buildEisenhowerMatrix([legacyTask("same", "low", null)], false, now);
    const after = buildEisenhowerMatrix([legacyTask("same", "high", dayAfter)], false, now);
    function position(matrix: typeof before) {
      for (const [row, columns] of Object.entries(matrix.cells)) {
        for (const [importance, values] of Object.entries(columns)) {
          if (values.some(task => task.id === "same")) return row + ":" + importance;
        }
      }
      throw new Error("Task disappeared from matrix");
    }
    expect(position(after)).toBe(position(before));
  });
});
