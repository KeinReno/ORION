import { describe, expect, it } from "vitest";
import { agentHubCommandSchema, agentHubExecutionSchema, type AgentHubExecution } from "@orion/shared-types";
import { AgentHubTransitionError, createAgentHubExecution, transitionAgentHubExecution } from "./agent-hub-lifecycle";

const t0 = "2026-10-29T10:00:00.000Z";
const at = (seconds: number): string => new Date(Date.parse(t0) + seconds * 1000).toISOString();
const fresh = (): AgentHubExecution => createAgentHubExecution("run-1", "workspace-1", { kind: "task", id: "task-1" }, t0);
const claim = (state = fresh()): AgentHubExecution => transitionAgentHubExecution(state, {
  type: "claim", expectedRevision: state.revision, at: at(1), workerId: "claude", runtimeId: "runtime-1", leaseMs: 30_000
});
const start = (state = claim()): AgentHubExecution => transitionAgentHubExecution(state, {
  type: "start", expectedRevision: state.revision, at: at(2), workerId: "claude"
});
const errorCode = (fn: () => unknown, code: string): void => {
  try { fn(); throw new Error("Expected transition to fail"); }
  catch (e) {
    expect(e).toBeInstanceOf(AgentHubTransitionError);
    expect((e as AgentHubTransitionError).code).toBe(code);
  }
};

describe("agent hub execution lifecycle", () => {
  it("starts with a serializable, schema-valid queued execution", () => {
    expect(agentHubExecutionSchema.parse(fresh())).toEqual(fresh());
    expect(fresh().revision).toBe(0);
  });

  it("enforces revision CAS and prevents duplicate claims", () => {
    const claimed = claim();
    errorCode(() => transitionAgentHubExecution(claimed, {
      type: "claim", expectedRevision: 0, at: at(2), workerId: "codex", runtimeId: "runtime-2", leaseMs: 30_000
    }), "stale_revision");
    errorCode(() => transitionAgentHubExecution(claimed, {
      type: "claim", expectedRevision: claimed.revision, at: at(2), workerId: "codex", runtimeId: "runtime-2", leaseMs: 30_000
    }), "invalid_transition");
  });

  it("binds execution to the claimed worker and a live lease", () => {
    const claimed = claim();
    errorCode(() => transitionAgentHubExecution(claimed, {
      type: "start", expectedRevision: 1, at: at(2), workerId: "codex"
    }), "not_worker");
    errorCode(() => transitionAgentHubExecution(claimed, {
      type: "start", expectedRevision: 1, at: at(32), workerId: "claude"
    }), "lease_expired");
  });

  it("saves checkpoint, submits evidence and requires independent verification", () => {
    const working = start();
    const checkpoint = transitionAgentHubExecution(working, {
      type: "checkpoint", expectedRevision: 2, at: at(3), workerId: "claude", checkpointRef: "git:abc123"
    });
    const review = transitionAgentHubExecution(checkpoint, {
      type: "submit", expectedRevision: 3, at: at(4), workerId: "claude", evidenceRefs: ["test:passed", "git:def456", "test:passed"]
    });
    expect(review.status).toBe("review");
    expect(review.checkpointRef).toBe("git:abc123");
    expect(review.evidenceRefs).toEqual(["test:passed", "git:def456"]);
    errorCode(() => transitionAgentHubExecution(review, {
      type: "verify", expectedRevision: 4, at: at(5), reviewerId: "claude"
    }), "self_review");
    const done = transitionAgentHubExecution(review, {
      type: "verify", expectedRevision: 4, at: at(5), reviewerId: "reviewer-1"
    });
    expect(done.status).toBe("done");
    expect(done.verifiedBy).toBe("reviewer-1");
    errorCode(() => transitionAgentHubExecution(done, {
      type: "cancel", expectedRevision: 5, at: at(6)
    }), "terminal");
  });

  it("cannot submit without evidence", () => {
    const working = start();
    expect(agentHubCommandSchema.safeParse({
      type: "submit", expectedRevision: 2, at: at(3), workerId: "claude", evidenceRefs: []
    }).success).toBe(false);
    errorCode(() => transitionAgentHubExecution(working, {
      type: "submit", expectedRevision: 2, at: at(3), workerId: "claude", evidenceRefs: []
    }), "invalid_evidence");
  });

  it("cannot expire a live lease and refuses stale heartbeats", () => {
    const claimed = claim();
    errorCode(() => transitionAgentHubExecution(claimed, { type: "expire", expectedRevision: 1, at: at(30) }), "lease_not_expired");
    errorCode(() => transitionAgentHubExecution(claimed, {
      type: "heartbeat", expectedRevision: 1, at: at(32), workerId: "claude", leaseMs: 30_000
    }), "lease_expired");
  });

  it("reclaims an expired lease without erasing the checkpoint", () => {
    const working = start();
    const checkpoint = transitionAgentHubExecution(working, {
      type: "checkpoint", expectedRevision: 2, at: at(3), workerId: "claude", checkpointRef: "snapshot:1"
    });
    const expired = transitionAgentHubExecution(checkpoint, { type: "expire", expectedRevision: 3, at: at(31) });
    expect(expired.status).toBe("queued");
    const next = transitionAgentHubExecution(expired, {
      type: "claim", expectedRevision: 4, at: at(32), workerId: "codex", runtimeId: "runtime-2", leaseMs: 30_000
    });
    expect(next.attempt).toBe(2);
    expect(next.checkpointRef).toBe("snapshot:1");
    expect(next.workerId).toBe("codex");
  });

  it("blocks and requeues only through coordinator action", () => {
    const working = start();
    const blocked = transitionAgentHubExecution(working, {
      type: "block", expectedRevision: 2, at: at(3), workerId: "claude", reason: "Requires owner approval"
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.leaseUntil).toBeNull();
    const queued = transitionAgentHubExecution(blocked, { type: "requeue", expectedRevision: 3, at: at(4) });
    expect(queued.status).toBe("queued");
  });

  it("treats failure and cancellation as terminal; retries need a new run", () => {
    const claimed = claim();
    const failed = transitionAgentHubExecution(claimed, {
      type: "fail", expectedRevision: 1, at: at(2), workerId: "claude", reason: "CLI unavailable"
    });
    errorCode(() => transitionAgentHubExecution(failed, {
      type: "claim", expectedRevision: 2, at: at(3), workerId: "codex", runtimeId: "runtime-2", leaseMs: 30_000
    }), "terminal");
    const canceled = transitionAgentHubExecution(fresh(), { type: "cancel", expectedRevision: 0, at: at(1) });
    expect(canceled.status).toBe("canceled");
  });

  it("rejects non-monotonic commands and invalid leases", () => {
    errorCode(() => transitionAgentHubExecution(fresh(), { type: "cancel", expectedRevision: 0, at: at(-1) }), "invalid_time");
    errorCode(() => transitionAgentHubExecution(fresh(), {
      type: "claim", expectedRevision: 0, at: at(1), workerId: "claude", runtimeId: "runtime-1", leaseMs: 0
    }), "invalid_transition");
  });
});
