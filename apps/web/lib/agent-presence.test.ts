import type { AgentPresenceEvent } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { followTarget, groupPresenceByAgent, navigationTarget, presencePillText, readStoredFollow } from "./agent-presence";

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

  it("opens only the chosen agent's latest record", () => {
    const cursor = event({ id: 1, tokenId: "cursor", agentName: "Cursor", objectType: "note", objectId: "note-1" });
    const sol = event({ id: 2, tokenId: "sol", agentName: "Sol", activity: "writing", objectType: "task", objectId: "task-9" });
    expect(navigationTarget([cursor, sol], { on: false, who: "sol" })).toBeNull();
    expect(navigationTarget([cursor, sol], { on: true, who: null })).toBeNull();
    expect(navigationTarget([cursor, sol], { on: true, who: "sol" })).toEqual({ type: "task", id: "task-9" });
    expect(navigationTarget([cursor, sol], { on: true, who: "cursor" })).toEqual({ type: "note", id: "note-1" });
  });

  it("keeps an older on-switch from opening every agent", () => {
    expect(readStoredFollow("1")).toEqual({ on: true, who: null });
    expect(readStoredFollow("0")).toEqual({ on: false, who: null });
    expect(readStoredFollow(JSON.stringify({ on: true, who: "sol" }))).toEqual({ on: true, who: "sol" });
  });

  it("keeps each token's trail separate and names both agents on the pill", () => {
    const cursor = event({ id: 3, tokenId: "cursor", agentName: "Cursor", summary: "Создал задачу «Отчёт»", activity: "writing" });
    const sol = event({ id: 2, tokenId: "sol", agentName: "Sol", module: "tasks", activity: "reading", objectType: "task", objectId: "task-1" });
    const older = event({ id: 1, tokenId: "cursor", agentName: "Cursor", activity: "reading" });
    const groups = groupPresenceByAgent([cursor, sol, older]);
    expect(groups.map((group) => group.label)).toEqual(["Cursor", "Sol"]);
    expect(groups[0]!.events.map((item) => item.id)).toEqual([3, 1]);
    expect(groups[1]!.events.map((item) => item.id)).toEqual([2]);
    expect(presencePillText([cursor, sol])).toBe("Cursor и Sol работают");
    expect(presencePillText([cursor])).toBe("Cursor · Создал задачу «Отчёт»");
  });

  it("ignores a read that has no record, or a type the shell cannot open", () => {
    expect(followTarget(event({ objectId: null }))).toBeNull();
    expect(followTarget(event({ objectId: "" }))).toBeNull();
    expect(followTarget(event({ objectType: null }))).toBeNull();
    expect(followTarget(event({ objectType: "transaction", objectId: "tx-1" }))).toBeNull();
  });
});
