import type { AgentPresenceEvent } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { followTarget } from "./agent-presence";

function event(overrides: Partial<AgentPresenceEvent> = {}): AgentPresenceEvent {
  return {
    id: 1,
    tokenId: "token",
    agentName: "Cursor",
    assistant: false,
    activity: "reading",
    module: "notes",
    summary: null,
    objectType: "note",
    objectId: "note-1",
    at: "2026-11-07T00:00:00.000Z",
    ...overrides
  };
}

describe("followTarget", () => {
  it("follows a read or a write of an openable record", () => {
    expect(followTarget(event())).toEqual({ type: "note", id: "note-1" });
    expect(followTarget(event({ activity: "writing", objectType: "task", objectId: "task-9", summary: "Создал задачу «Отчёт»" }))).toEqual({
      type: "task",
      id: "task-9"
    });
    for (const objectType of ["event", "document", "project", "contact", "goal", "list"] as const) {
      expect(followTarget(event({ objectType, objectId: `${objectType}-1` }))).toEqual({ type: objectType, id: `${objectType}-1` });
    }
  });

  it("does not navigate on a refusal, a proposal, or thinking", () => {
    for (const activity of ["denied", "proposing", "thinking"] as const) {
      expect(followTarget(event({ activity }))).toBeNull();
    }
  });

  it("ignores a read that has no record, or a type the shell cannot open", () => {
    expect(followTarget(event({ objectId: null }))).toBeNull();
    expect(followTarget(event({ objectId: "" }))).toBeNull();
    expect(followTarget(event({ objectType: null }))).toBeNull();
    expect(followTarget(event({ objectType: "transaction", objectId: "tx-1" }))).toBeNull();
  });
});
