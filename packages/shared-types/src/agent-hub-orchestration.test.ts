import { describe, expect, it } from "vitest";
import { AgentHubTransitionError, createAgentHubExecution, transitionAgentHubExecution } from "./agent-hub-lifecycle";
import { effectiveAgentHubDelegationDepth, planAgentHubDelegation, agentHubApprovalPauseRequired, agentHubDelegationPolicySchema } from "./agent-hub-orchestration";
import type { AgentHubExecution } from "./agent-hub";

const t0 = "2026-11-11T12:00:00.000Z";
const at = (seconds: number): string => new Date(Date.parse(t0) + seconds * 1000).toISOString();
const fresh = (): AgentHubExecution => createAgentHubExecution("run-1", "ws-1", { kind: "task", id: "task-1" }, t0);

function claimed(): AgentHubExecution {
  return transitionAgentHubExecution(fresh(), {
    type: "claim", expectedRevision: 0, at: at(1), workerId: "worker-1", runtimeId: "manual-mcp:worker-1", leaseMs: 120_000
  });
}
function working(): AgentHubExecution {
  return transitionAgentHubExecution(claimed(), { type: "start", expectedRevision: 1, at: at(2), workerId: "worker-1" });
}

describe("Agent Hub approval gate", () => {
  it("pauses a running execution and resumes it only through a human decision", () => {
    const pending = transitionAgentHubExecution(working(), {
      type: "request_approval", expectedRevision: 2, at: at(3), workerId: "worker-1",
      action: "finance.transaction.create", reason: "Меняет деньги"
    });
    expect(pending.status).toBe("waiting_approval");
    expect(pending.approval).toMatchObject({ action: "finance.transaction.create", requestedBy: "worker-1" });

    // The worker can keep its lease while a human thinks, but cannot act on its own.
    const heartbeat = transitionAgentHubExecution(pending, { type: "heartbeat", expectedRevision: 3, at: at(4), workerId: "worker-1", leaseMs: 120_000 });
    expect(heartbeat.status).toBe("waiting_approval");
    expect(() => transitionAgentHubExecution(heartbeat, { type: "start", expectedRevision: 4, at: at(5), workerId: "worker-1" }))
      .toThrow(AgentHubTransitionError);

    const approved = transitionAgentHubExecution(heartbeat, { type: "approve", expectedRevision: 4, at: at(6), reviewerId: "owner-1" });
    expect(approved.status).toBe("working");
    expect(approved.approval).toBeNull();
    expect(Date.parse(approved.leaseUntil!)).toBe(Date.parse(at(6)) + 120_000);
  });

  it("rejects with a reason and becomes terminal", () => {
    const pending = transitionAgentHubExecution(working(), {
      type: "request_approval", expectedRevision: 2, at: at(3), workerId: "worker-1", action: "x", reason: "y"
    });
    const failed = transitionAgentHubExecution(pending, { type: "reject", expectedRevision: 3, at: at(4), reviewerId: "owner-1", reason: "Нельзя" });
    expect(failed).toMatchObject({ status: "failed", blockedReason: "Нельзя", approval: null });
    expect(() => transitionAgentHubExecution(failed, { type: "cancel", expectedRevision: 4, at: at(5) })).toThrow(AgentHubTransitionError);
  });

  it("requires a live lease to ask for approval", () => {
    expect(() => transitionAgentHubExecution(working(), {
      type: "request_approval", expectedRevision: 2, at: at(200), workerId: "worker-1", action: "x", reason: "y"
    })).toThrow(AgentHubTransitionError);
  });
});

describe("Agent Hub reassignment", () => {
  it("ends the current branch as reassigned and frees it for a replacement", () => {
    const reassigned = transitionAgentHubExecution(working(), {
      type: "reassign", expectedRevision: 2, at: at(3), reason: "Другой профиль"
    });
    expect(reassigned).toMatchObject({ status: "reassigned", workerId: null, leaseUntil: null });
    expect(() => transitionAgentHubExecution(reassigned, { type: "claim", expectedRevision: 3, at: at(4), workerId: "w", runtimeId: "r", leaseMs: 120_000 }))
      .toThrow(AgentHubTransitionError);
  });
});

describe("delegation guard", () => {
  const base = { parentChain: [] as string[], parentDepth: 0, parentDelegatedTo: null as string | null, maxDepth: 3 };

  it("allows a new branch and records the chain", () => {
    expect(planAgentHubDelegation({ ...base, delegatorProfileId: "A", targetProfileId: "B" }))
      .toEqual({ ok: true, chain: ["A", "B"], depth: 1 });
  });

  it("refuses A → B → A", () => {
    const child = planAgentHubDelegation({ ...base, delegatorProfileId: "A", targetProfileId: "B" });
    if (!child.ok) throw new Error("unexpected");
    expect(planAgentHubDelegation({
      parentChain: child.chain, parentDepth: child.depth, parentDelegatedTo: "B", delegatorProfileId: "B", targetProfileId: "A", maxDepth: 3
    })).toEqual({ ok: false, reason: "delegation_cycle" });
  });

  it("refuses delegating to itself", () => {
    expect(planAgentHubDelegation({ ...base, delegatorProfileId: "A", targetProfileId: "A" }))
      .toEqual({ ok: false, reason: "delegation_cycle" });
  });

  it("refuses depth above the owner limit", () => {
    expect(planAgentHubDelegation({
      parentChain: ["A", "B", "C"], parentDepth: 3, parentDelegatedTo: "C", delegatorProfileId: "C", targetProfileId: "D", maxDepth: 3
    })).toEqual({ ok: false, reason: "delegation_depth_exceeded" });
  });

  it("lets a delegator tighten but never widen the policy", () => {
    expect(effectiveAgentHubDelegationDepth(3, 2)).toBe(2);
    expect(effectiveAgentHubDelegationDepth(2, 5)).toBe(2);
    expect(effectiveAgentHubDelegationDepth(99, undefined)).toBe(6);
    expect(effectiveAgentHubDelegationDepth(0, undefined)).toBe(1);
  });
});

describe("agentHubApprovalPauseRequired (P3-1: подтверждения только для не-админов)", () => {
  it("non_admin: админ-агент действует без паузы, остальные — с паузой", () => {
    expect(agentHubApprovalPauseRequired("non_admin", true)).toBe(false);
    expect(agentHubApprovalPauseRequired("non_admin", false)).toBe(true);
  });

  it("all: пауза независимо от прав", () => {
    expect(agentHubApprovalPauseRequired("all", true)).toBe(true);
    expect(agentHubApprovalPauseRequired("all", false)).toBe(true);
  });

  it("политика парсится с дефолтом non_admin для старых записей", () => {
    const legacy = agentHubDelegationPolicySchema.parse({ workspaceId: "ws", maxDelegationDepth: 3, updatedAt: null });
    expect(legacy.approvals).toBe("non_admin");
    const explicit = agentHubDelegationPolicySchema.parse({ workspaceId: "ws", maxDelegationDepth: 3, approvals: "all", updatedAt: null });
    expect(explicit.approvals).toBe("all");
  });
});
