import { describe, expect, it, vi } from "vitest";
import { createObjectContextStore, type PanelObjectContext } from "./object-context-store";

const object = (workspaceId: string, panelId: string, entityId: string): PanelObjectContext => ({
  workspaceId, panelId, entityId, entityType: "task", title: entityId, saveState: "saved", hasPendingChanges: false
});

describe("panel object contexts", () => {
  it("isolates workspaces, inactive panels and independent window stores", () => {
    const store = createObjectContextStore();
    const active = object("personal", "tasks", "one");
    store.publish(active);
    store.publish(object("studio", "tasks", "team task"));
    store.publish(object("personal", "project:p", "background task"));
    expect(store.get("personal", "tasks")).toBe(active);
    expect(store.get("studio", "tasks")?.entityId).toBe("team task");
    expect(store.get("missing", "tasks")).toBeNull();
    expect(createObjectContextStore().get("personal", "tasks")).toBeNull();
  });

  it("late cleanup cannot delete the replacement editor or another panel", () => {
    const store = createObjectContextStore();
    const closeOld = store.publish(object("w", "tasks", "old"));
    const current = object("w", "tasks", "new");
    const closeCurrent = store.publish(current);
    store.publish(object("w", "project:p", "project task"));
    closeOld();
    expect(store.get("w", "tasks")).toBe(current);
    closeCurrent();
    expect(store.get("w", "tasks")).toBeNull();
    expect(store.get("w", "project:p")?.entityId).toBe("project task");
  });

  it("notifies consumers on publish and current cleanup, and supports unsubscribe", () => {
    const store = createObjectContextStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const cleanup = store.publish(object("w", "tasks", "one"));
    expect(listener).toHaveBeenCalledTimes(1);
    cleanup();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.publish(object("w", "tasks", "two"));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
