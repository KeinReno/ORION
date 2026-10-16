import { describe, expect, it } from "vitest";
import { notesViewStateSchema, readViewState, tasksViewStateSchema, type TasksViewState, viewStateKey, VIEW_STATE_VERSION, writeViewState } from "./view-state";

function memory(): Storage {
  const map = new Map<string, string>();
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: k => void map.delete(k), clear: () => map.clear(), key: () => null, length: 0 } as Storage;
}
const uuid = "6f1c2b9e-3a47-4c1e-9d55-0a8b7c6d5e4f";
const tasks: TasksViewState = { dueFilter: "week", statusFilter: ["todo"], priorityFilter: [], groupBy: "due", projectFilter: uuid, editingId: uuid };

describe("view state", () => {
  const key = viewStateKey("u", "w");
  it("round-trips a valid state per panel", () => {
    const s = memory();
    writeViewState(s, key, "tasks", tasksViewStateSchema, tasks);
    expect(readViewState(s, key, "tasks", tasksViewStateSchema)).toEqual(tasks);
    expect(readViewState(s, key, "notes", notesViewStateSchema)).toBeNull();
  });
  it("is keyed by user and workspace", () => {
    const s = memory();
    writeViewState(s, key, "tasks", tasksViewStateSchema, tasks);
    expect(readViewState(s, viewStateKey("u", "other"), "tasks", tasksViewStateSchema)).toBeNull();
  });
  it("drops corrupt json, unknown versions, wrong shapes and extra fields", () => {
    const s = memory();
    s.setItem(key, "{not json");
    expect(readViewState(s, key, "tasks", tasksViewStateSchema)).toBeNull();
    s.setItem(key, JSON.stringify({ tasks: { v: VIEW_STATE_VERSION + 1, state: tasks } }));
    expect(readViewState(s, key, "tasks", tasksViewStateSchema)).toBeNull();
    s.setItem(key, JSON.stringify({ tasks: { v: VIEW_STATE_VERSION, state: { ...tasks, dueFilter: "later" } } }));
    expect(readViewState(s, key, "tasks", tasksViewStateSchema)).toBeNull();
    s.setItem(key, JSON.stringify({ tasks: { v: VIEW_STATE_VERSION, state: { ...tasks, body: "secret" } } }));
    expect(readViewState(s, key, "tasks", tasksViewStateSchema)).toBeNull();
    s.setItem(key, JSON.stringify({ tasks: { v: VIEW_STATE_VERSION, state: { ...tasks, editingId: "../x" } } }));
    expect(readViewState(s, key, "tasks", tasksViewStateSchema)).toBeNull();
  });
  it("never writes an invalid state and survives a failing storage", () => {
    const s = memory();
    writeViewState(s, key, "tasks", tasksViewStateSchema, { ...tasks, dueFilter: "x" } as never);
    expect(s.getItem(key)).toBeNull();
    const broken = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(() => writeViewState(broken, key, "tasks", tasksViewStateSchema, tasks)).not.toThrow();
  });
});
