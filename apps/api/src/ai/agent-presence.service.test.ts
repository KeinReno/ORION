import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentPresenceService, objectOfResource, presenceActivity, type PresenceInput } from "./agent-presence.service";

const base: PresenceInput = {
  workspaceId: "ws1",
  userId: "u1",
  tokenId: "t1",
  agentName: "Claude Desktop",
  assistant: false,
  activity: "reading",
  module: "tasks",
  summary: null,
  objectType: null,
  objectId: null
};

describe("agent presence", () => {
  afterEach(() => vi.useRealTimers());

  it("tells reads from writes, proposals and refusals", () => {
    expect(presenceActivity("tasks.list", 200, false)).toBe("reading");
    expect(presenceActivity("notes.get", 200, false)).toBe("reading");
    expect(presenceActivity("orion_get_context", 200, false)).toBe("reading");
    expect(presenceActivity("tasks.create", 200, true)).toBe("writing");
    expect(presenceActivity("links.create", 200, false)).toBe("writing");
    expect(presenceActivity("tasks.update", 202, false)).toBe("proposing");
    expect(presenceActivity("tasks.update", 403, false)).toBe("denied");
  });

  it("reads the object from a resource", () => {
    expect(objectOfResource("task:abc-1")).toEqual({ type: "task", id: "abc-1" });
    expect(objectOfResource("link:x")).toEqual({ type: "link", id: "x" });
    expect(objectOfResource(null)).toBeNull();
    expect(objectOfResource("free text")).toBeNull();
  });

  it("shows each member only their own agents, in this workspace, for two minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    const presence = new AgentPresenceService();
    presence.push(base);
    presence.push({ ...base, userId: "u2", agentName: "Чужой агент" });
    presence.push({ ...base, workspaceId: "ws2" });
    expect(presence.recent("ws1", "u1").events.map((event) => event.agentName)).toEqual(["Claude Desktop"]);
    expect(presence.recent("ws1", "u1").events[0]).not.toHaveProperty("userId");

    vi.setSystemTime(new Date("2026-10-20T12:02:01Z"));
    expect(presence.recent("ws1", "u1").events).toEqual([]);
  });

  it("keeps a bounded feed per workspace", () => {
    const presence = new AgentPresenceService();
    for (let i = 0; i < 100; i++) presence.push({ ...base, summary: String(i) });
    const events = presence.recent("ws1", "u1").events;
    expect(events).toHaveLength(60);
    expect(events.at(-1)?.summary).toBe("99");
  });
});
