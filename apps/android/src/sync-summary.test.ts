import { expect, it } from "vitest";
import type { ReplicaStatus } from "@orion/core";
import { syncSummary } from "./sync-summary";
const state = { phase: "idle", pending: 0, conflicts: 0, hasCopy: true, asOf: null } as ReplicaStatus;
it("keeps normal offline and settled states out of the working list", () => {
  for (const phase of ["idle", "offline", "syncing", "error", "incompatible"] as const) {
    expect(syncSummary({ ...state, phase })).toBeNull();
  }
  expect(syncSummary()).toBeNull();
});
it("retains actionable pending, conflict and revoked signals", () => {
  expect(syncSummary({ ...state, phase: "offline", pending: 8 })?.label).toBe("В очереди: 8");
  expect(syncSummary({ ...state, pending: 8, conflicts: 2 })?.label).toBe("Конфликты: 2");
  expect(syncSummary({ ...state, phase: "revoked", pending: 8 })?.label).toBe("Доступ приостановлен");
});
