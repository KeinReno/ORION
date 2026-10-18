import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CapabilityLifecycle } from "../src/common/capability-lifecycle";
import { Hub } from "./opportunity-hub-fixtures";

describe("Capability lifecycle transactional contract", () => {
  const hub = new Hub(); beforeAll(() => hub.start()); afterAll(() => hub.stop());
  it("a failing contribution rolls back module/plugin configuration in the same transaction", async () => {
    const a = await hub.register("lifecycle-rollback"); await hub.enable(a, "opportunities-hh-import");
    hub.app.get(CapabilityLifecycle).register("test-rollback", async (_tx, change) => {
      if (change.workspaceId === a.workspaceId && !change.enabled) throw new Error("Synthetic lifecycle failure");
    });
    for (const [kind, id] of [["modules", "opportunities"], ["plugins", "opportunities-hh-import"]]) {
      expect((await hub.req(`/workspaces/${a.workspaceId}/${kind}/${id}`, a.token, "PATCH", { enabled: false, confirm: true })).status).toBe(500);
      const list = await hub.req<{ id: string; enabled: boolean }[]>(`/workspaces/${a.workspaceId}/${kind}`, a.token);
      expect(list.data.find((item) => item.id === id)?.enabled).toBe(true);
    }
  });
  it("concurrent plugin toggles preserve both overrides instead of losing one", async () => {
    const a = await hub.register("lifecycle-race");
    const names = ["opportunities-profiles", "opportunities-assistant"];
    const changed = await Promise.all(names.map((id) => hub.req(`/workspaces/${a.workspaceId}/plugins/${id}`, a.token, "PATCH", { enabled: true })));
    expect(changed.map((r) => r.status)).toEqual([200, 200]);
    const list = await hub.req<{ id: string; enabled: boolean }[]>(`/workspaces/${a.workspaceId}/plugins`, a.token);
    for (const id of names) expect(list.data.find((item) => item.id === id)?.enabled).toBe(true);
  });
});
