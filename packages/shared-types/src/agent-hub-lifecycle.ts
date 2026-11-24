import {
  AGENT_HUB_TERMINAL_STATUS_SET,
  type AgentHubCommand,
  type AgentHubExecution,
  type AgentHubTarget
} from "./agent-hub";

export type AgentHubTransitionErrorCode =
  | "stale_revision"
  | "terminal"
  | "invalid_transition"
  | "not_worker"
  | "lease_expired"
  | "lease_not_expired"
  | "invalid_time"
  | "invalid_evidence"
  | "self_review"
  | "wall_clock";

export class AgentHubTransitionError extends Error {
  constructor(public readonly code: AgentHubTransitionErrorCode) {
    super(code);
    this.name = "AgentHubTransitionError";
  }
}

/** An approval decision resumes the worker for another two minutes, like a fresh claim. */
export const APPROVAL_RESUME_LEASE_MS = 120_000;

export function createAgentHubExecution(
  id: string,
  workspaceId: string,
  target: AgentHubTarget,
  at: string,
  delegation: {
    parentExecutionId?: string | null;
    delegationDepth?: number;
    delegatedToProfileId?: string | null;
    delegationChain?: string[];
    delegationPayload?: Record<string, unknown>;
  } = {}
): AgentHubExecution {
  if (!id || !workspaceId || !target.id || !Number.isFinite(Date.parse(at))) {
    throw new AgentHubTransitionError("invalid_time");
  }
  return {
    id, workspaceId, target, status: "queued", revision: 0, attempt: 0,
    workerId: null, runtimeId: null, leaseUntil: null, checkpointRef: null,
    evidenceRefs: [], verifiedBy: null, blockedReason: null, updatedAt: at,
    parentExecutionId: delegation.parentExecutionId ?? null,
    delegationDepth: delegation.delegationDepth ?? 0,
    delegatedToProfileId: delegation.delegatedToProfileId ?? null,
    delegationChain: delegation.delegationChain ?? [],
    delegationPayload: delegation.delegationPayload ?? {},
    approval: null,
    resultSummary: null
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
  if (AGENT_HUB_TERMINAL_STATUS_SET.has(current.status)) throw new AgentHubTransitionError("terminal");

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
      assertStatus("claimed", "working", "waiting_approval");
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
      return { ...next, status: "review", leaseUntil: null, evidenceRefs: [...new Set(command.evidenceRefs)],
        resultSummary: command.summary ?? current.resultSummary };
    case "verify":
      assertStatus("review");
      if (command.reviewerId === current.workerId) throw new AgentHubTransitionError("self_review");
      if (current.evidenceRefs.length === 0) throw new AgentHubTransitionError("invalid_evidence");
      return { ...next, status: "done", verifiedBy: command.reviewerId };
    case "return_for_rework":
      assertStatus("review");
      if (command.reviewerId === current.workerId) throw new AgentHubTransitionError("self_review");
      return {
        ...next, status: "queued", workerId: null, runtimeId: null, leaseUntil: null,
        evidenceRefs: [], resultSummary: null, verifiedBy: null, blockedReason: command.reason
      };
    case "fail":
      assertStatus("claimed", "working");
      assertWorker(command.workerId);
      assertLiveLease();
      return { ...next, status: "failed", leaseUntil: null, blockedReason: command.reason,
        resultSummary: command.summary ?? current.resultSummary };
    case "expire":
      assertStatus("claimed", "working", "waiting_approval");
      if (!current.leaseUntil || now < Date.parse(current.leaseUntil)) {
        throw new AgentHubTransitionError("lease_not_expired");
      }
      // Checkpoint remains available to the next, independently authorized worker.
      return { ...next, status: "queued", workerId: null, runtimeId: null, leaseUntil: null, approval: null };
    case "cancel":
      return { ...next, status: "canceled", leaseUntil: null, approval: null };
    case "request_approval":
      assertStatus("working");
      assertWorker(command.workerId);
      assertLiveLease();
      return { ...next, status: "waiting_approval",
        approval: { action: command.action, reason: command.reason, requestedAt: command.at, requestedBy: command.workerId } };
    case "approve":
      assertStatus("waiting_approval");
      // Only the human owner/lead reaches this command; the worker can never approve itself.
      return { ...next, status: "working", approval: null, leaseUntil: leaseUntil(APPROVAL_RESUME_LEASE_MS) };
    case "reject":
      assertStatus("waiting_approval");
      return { ...next, status: "failed", approval: null, leaseUntil: null, blockedReason: command.reason };
    case "reassign":
      assertStatus("queued", "claimed", "working", "waiting_approval", "blocked");
      return { ...next, status: "reassigned", workerId: null, runtimeId: null, leaseUntil: null, approval: null };
  }
}
