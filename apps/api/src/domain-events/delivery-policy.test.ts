import { describe, expect, it } from "vitest";
import { DOMAIN_EVENT_CATALOG, DOMAIN_EVENT_SUBSCRIPTIONS, COMPONENT_MANIFESTS, isDomainEventType } from "@orion/shared-types";
import {
  backoffMs,
  isComponentEnabled,
  MAX_DELIVERY_ATTEMPTS,
  statusAfterFailure,
  subscribersFor
} from "./delivery-policy";

describe("backoff", () => {
  it("doubles from 30 s and caps at one hour", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(20)).toBe(3_600_000);
  });
  it("turns failed only when attempts are exhausted", () => {
    expect(statusAfterFailure(MAX_DELIVERY_ATTEMPTS - 1)).toBe("pending");
    expect(statusAfterFailure(MAX_DELIVERY_ATTEMPTS)).toBe("failed");
  });
});

describe("subscribersFor", () => {
  const subs = [
    { id: "a", componentId: "tasks", types: ["tasks.task.closed"] as const },
    { id: "b", componentId: "notes", types: [] as const }
  ];
  it("keeps only subscribers of the type", () => {
    expect(subscribersFor(subs, "tasks.task.closed").map((s) => s.id)).toEqual(["a"]);
    expect(subscribersFor(subs, "nope")).toEqual([]);
  });
});

describe("isComponentEnabled", () => {
  const on = { disabledModules: [] as string[], pluginOverrides: [] as string[] };
  it("module follows disabledModules", () => {
    expect(isComponentEnabled("tasks", on)).toBe(true);
    expect(isComponentEnabled("tasks", { ...on, disabledModules: ["tasks"] })).toBe(false);
  });
  it("plugin needs its own switch and its host module", () => {
    // "team" is off by default (extends tasks); an override flips it on.
    expect(isComponentEnabled("team", on)).toBe(false);
    expect(isComponentEnabled("team", { ...on, pluginOverrides: ["team"] })).toBe(true);
    expect(isComponentEnabled("team", { disabledModules: ["tasks"], pluginOverrides: ["team"] })).toBe(false);
  });
  it("unknown component is disabled", () => {
    expect(isComponentEnabled("ghost", on)).toBe(false);
  });
  it("core infrastructure is always enabled", () => {
    expect(isComponentEnabled("core", { disabledModules: ["tasks"], pluginOverrides: [] })).toBe(true);
  });
});

describe("declared subscriptions", () => {
  it("point at existing components and catalogued event types", () => {
    const ids = new Set(COMPONENT_MANIFESTS.map((m) => m.id));
    for (const sub of DOMAIN_EVENT_SUBSCRIPTIONS) {
      expect(ids.has(sub.componentId), sub.id).toBe(true);
      for (const t of sub.types) expect(isDomainEventType(t), `${sub.id}:${t}`).toBe(true);
    }
    expect(new Set(DOMAIN_EVENT_SUBSCRIPTIONS.map((s) => s.id)).size).toBe(DOMAIN_EVENT_SUBSCRIPTIONS.length);
  });
  it("are mirrored by manifests (events.subscribes / events.publishes)", () => {
    for (const sub of DOMAIN_EVENT_SUBSCRIPTIONS) {
      const manifest = COMPONENT_MANIFESTS.find((m) => m.id === sub.componentId)!;
      for (const t of sub.types) expect(manifest.events.subscribes).toContain(t);
    }
    for (const [type, def] of Object.entries(DOMAIN_EVENT_CATALOG)) {
      // "core" is platform infrastructure, not a manifest module: it has no events.publishes row.
      if (def.publisher === "core") continue;
      expect(COMPONENT_MANIFESTS.find((m) => m.id === def.publisher)!.events.publishes).toContain(type);
    }
  });
});
