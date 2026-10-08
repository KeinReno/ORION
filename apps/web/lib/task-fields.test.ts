import type { Task } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { buildPatch, fieldsFromTask, sameFields } from "./task-fields";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    workspaceId: "w1",
    title: "Задача",
    description: "Описание",
    status: "todo",
    priority: "normal",
    dueAt: "2026-10-09T09:00:00.000Z",
    startAt: null,
    estimatedMinutes: 90,
    projectId: "p1",
    projectTag: null,
    parentId: null,
    milestoneId: null,
    assigneeId: null,
    recurrence: null,
    dependencyIds: ["b", "a"],
    sortOrder: 0,
    completedAt: null,
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
    ...overrides
  } as Task;
}

describe("task detail autosave diff", () => {
  it("sends nothing when nothing changed", () => {
    const fields = fieldsFromTask(task());
    expect(buildPatch(fields, { ...fields }, true)).toEqual({});
    expect(sameFields(fields, { ...fields })).toBe(true);
  });

  it("sends only the changed keys, so an untouched field can't overwrite a newer server value", () => {
    const base = fieldsFromTask(task());
    expect(buildPatch(base, { ...base, description: "Новое" }, true)).toEqual({ description: "Новое" });
    expect(buildPatch(base, { ...base, status: "done", priority: "high" }, true)).toEqual({ status: "done", priority: "high" });
  });

  it("never sends a blank title, and trims the one it sends", () => {
    const base = fieldsFromTask(task());
    expect(buildPatch(base, { ...base, title: "   " }, true)).toEqual({});
    expect(buildPatch(base, { ...base, title: "  Переименовано " }, true)).toEqual({ title: "Переименовано" });
  });

  it("clears optional fields with null and converts hours to minutes", () => {
    const base = fieldsFromTask(task({ startAt: "2026-10-02T09:00:00.000Z", assigneeId: "m1" }));
    const patch = buildPatch(base, { ...base, dueAt: "", startAt: "", projectId: "", assigneeId: "", estimatedHours: "2.5" }, true);
    expect(patch).toEqual({ dueAt: null, startAt: null, projectId: null, assigneeId: null, estimatedMinutes: 150 });
  });

  it("treats an unparsable estimate as 'not estimated'", () => {
    const base = fieldsFromTask(task());
    expect(buildPatch(base, { ...base, estimatedHours: "много" }, true)).toEqual({ estimatedMinutes: null });
  });

  it("leaves the assignee out when the team plugin is off", () => {
    const base = fieldsFromTask(task());
    expect(buildPatch(base, { ...base, assigneeId: "m2" }, false)).toEqual({});
  });

  it("builds a recurrence, clamps the interval, and clears it", () => {
    const base = fieldsFromTask(task());
    expect(buildPatch(base, { ...base, recurrenceFreq: "weekly", recurrenceInterval: "2" }, true)).toEqual({
      recurrence: { freq: "weekly", interval: 2 }
    });
    expect(buildPatch(base, { ...base, recurrenceFreq: "daily", recurrenceInterval: "9999" }, true)).toEqual({
      recurrence: { freq: "daily", interval: 365 }
    });
    const repeating = fieldsFromTask(task({ recurrence: { freq: "daily", interval: 1 } }));
    expect(buildPatch(repeating, { ...repeating, recurrenceFreq: "" }, true)).toEqual({ recurrence: null });
  });

  it("compares dependencies as a set, not by the order the server returned them", () => {
    const base = fieldsFromTask(task({ dependencyIds: ["b", "a"] }));
    expect(base.dependencyIds).toEqual(["a", "b"]);
    expect(buildPatch(base, { ...base, dependencyIds: ["a", "b"] }, true)).toEqual({});
    expect(buildPatch(base, { ...base, dependencyIds: ["a"] }, true)).toEqual({ dependencyIds: ["a"] });
  });
});
