import { describe, expect, it, vi } from "vitest";
import { createPlaces, placeKey, type WidgetPlace } from "./places";

const widget = (id: string, patch: Partial<WidgetPlace> = {}): WidgetPlace => ({ pluginId: "demo", id, title: id, component: () => null, ...patch });

describe("places", () => {
  it("lists by order, then registration, and keeps the first of a duplicated key", () => {
    const store = createPlaces();
    store.add("widget", widget("b", { order: 2 }));
    store.add("widget", widget("a"));
    store.add("widget", widget("c", { order: 2 }));
    store.add("widget", widget("a", { title: "второй" }));
    expect(store.list("widget").map(placeKey)).toEqual(["demo.a", "demo.b", "demo.c"]);
    expect(store.find("widget", "demo.a")?.title).toBe("a");
  });

  it("notifies subscribers and undoes a registration", () => {
    const store = createPlaces();
    const listener = vi.fn();
    store.subscribe(listener);
    const remove = store.add("widget", widget("a"));
    const before = store.version();
    remove();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.version()).toBeGreaterThan(before);
    expect(store.list("widget")).toEqual([]);
    remove();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps kinds apart and rejects an id that cannot be a panel instance", () => {
    const store = createPlaces();
    store.add("widget", widget("a"));
    expect(store.list("settings")).toEqual([]);
    expect(() => store.add("widget", widget("Bad id"))).toThrow(/kebab-case/);
  });
});
