import {
  type AgentHubCommand,
  type AgentHubExecution,
  type AgentHubTarget
} from "@orion/shared-types";

export type AgentHubTransitionErrorCode =
  | "stale_revision"
  | "terminal"
  | "invalid_transition"
  | "not_worker"
  | "lease_expired"
  | "lease_not_expired"
  | "invalid_time"
  | "invalid_evidence"
  | "self_review";

export class AgentHubTransitionError extends Error {
  constructor(public readonly code: AgentHubTransitionErrorCode) {
    super(code);
    this.name = "AgentHubTransitionError";
  }
}

const TERMINAL = new Set(["done", "failed", "canceled"]);

export function createAgentHubExecution(
  id: string,
  workspaceId: string,
  target: AgentHubTarget,
  at: string
): AgentHubExecution {
  if (!id || !workspaceId || !target.id || !Number.isFinite(Date.parse(at))) {
    throw new AgentHubTransitionError("invalid_time");
  }
  return {
    id, workspaceId, target, status: "queued", revision: 0, attempt: 0,
    workerId: null, runtimeId: null, leaseUntil: null, checkpointRef: null,
    evidenceRefs: [], verifiedBy: null, blockedReason: null, updatedAt: at
  };
}

/**
 * Deterministic transition policy, with no side effects. The repository adapter
 * MUST commit state, journal and expected revision atomically (CAS); this helper
 * does not itself prevent concurrent database writes or authorize callers.
 */
export function transitionAgentHubExecution(
  current: AgentHubExecution,
  command: AgentHubCommand
): AgentHubExecution {
  if (command.expectedRevision !== current.revision) throw new AgentHubTransitionError("stale_revision");
  if (TERMINAL.has(current.status)) throw new AgentHubTransitionError("terminal");

  const now = Date.parse(command.at);
  if (!Number.isFinite(now) || now < Date.parse(current.updatedAt)) {
    throw new AgentHubTransitionError("invalid_time");
  }
  const next: AgentHubExecution = { ...current, updatedAt: command.at, revision: current.revision + 1 };

  const assertStatus = (...statuses: AgentHubExecution["status"][]): void => {
    if (!statuses.includes(current.status)) throw new AgentHubTransitionError("invalid_transition");
  };
  const assertWorker = (workerId: string): void => {
    if (!current.workerId || workerId !== current.workerId) throw new AgentHubTransitionError("not_worker");
  };
  const assertLiveLease = (): void => {
    if (!current.leaseUntil || now >= Date.parse(current.leaseUntil)) throw new AgentHubTransitionError("lease_expired");
  };
  const leaseUntil = (ms: number): string => {
    if (!Number.isInteger(ms) || ms < 30_000 || ms > 1_800_000) throw new AgentHubTransitionError("invalid_transition");
    return new Date(now + ms).toISOString();
  };

  switch (command.type) {
    case "claim":
      assertStatus("queued");
      return { ...next, status: "claimed", workerId: command.workerId, runtimeId: command.runtimeId,
        leaseUntil: leaseUntil(command.leaseMs), attempt: current.attempt + 1, blockedReason: null };
    case "start":
      assertStatus("claimed");
      assertWorker(command.workerId);
      assertLiveLease();
      return { ...next, status: "working" };
    case "heartbeat":
      assertStatus("claimed", "working");
      assertWorker(command.workerId);
      assertLiveLease();
      return { ...next, leaseUntil: leaseUntil(command.leaseMs) };
    case "checkpoint":
      assertStatus("working");
      assertWorker(command.workerId);
      assertLiveLease();
      return { ...next, checkpointRef: command.checkpointRef };
    case "block":
      assertStatus("working");
      assertWorker(command.workerId);
      assertLiveLease();
      return { ...next, status: "blocked", leaseUntil: null, blockedReason: command.reason };
    case "requeue":
      assertStatus("blocked");
      return { ...next, status: "queued", workerId: null, runtimeId: null, leaseUntil: null, blockedReason: null };
    case "submit":
      assertStatus("working");
      assertWorker(command.workerId);
      assertLiveLease();
      if (!command.evidenceRefs.length || command.evidenceRefs.some((ref) => !ref.trim())) {
        throw new AgentHubTransitionError("invalid_evidence");
      }
      return { ...next, status: "review", leaseUntil: null, evidenceRefs: [...new Set(command.evidenceRefs)] };
    case "verify":
      assertStatus("review");
      if (command.reviewerId === current.workerId) throw new AgentHubTransitionError("self_review");
      if (current.evidenceRefs.length === 0) throw new AgentHubTransitionError("invalid_evidence");
      return { ...next, status: "done", verifiedBy: command.reviewerId };
    case "fail":
      assertStatus("claimed", "working");
      assertWorker(command.workerId);
      assertLiveLease();
      return { ...next, status: "failed", leaseUntil: null, blockedReason: command.reason };
    case "expire":
      assertStatus("claimed", "working");
      if (!current.leaseUntil || now < Date.parse(current.leaseUntil)) {
        throw new AgentHubTransitionError("lease_not_expired");
      }
      // Checkpoint remains available to the next, independently authorized worker.
      return { ...next, status: "queued", workerId: null, runtimeId: null, leaseUntil: null };
    case "cancel":
      return { ...next, status: "canceled", leaseUntil: null };
  }
}
