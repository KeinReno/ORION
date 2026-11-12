import type { AgentHubEvent as EventRow, AgentHubExecution as ExecutionRow } from "@prisma/client";
import { agentHubExecutionSchema, type AgentHubEvent, type AgentHubExecution } from "@orion/shared-types";

/** DB row → wire DTO. The only place where Agent Hub execution/event rows leave the service layer. */
export function executionDto(row: ExecutionRow): AgentHubExecution {
  return agentHubExecutionSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    target: { kind: row.targetKind, id: row.targetId },
    status: row.status,
    revision: row.revision,
    attempt: row.attempt,
    workerId: row.workerId,
    runtimeId: row.runtimeId,
    leaseUntil: row.leaseUntil?.toISOString() ?? null,
    checkpointRef: row.checkpointRef,
    evidenceRefs: row.evidenceRefs,
    verifiedBy: row.verifiedBy,
    blockedReason: row.blockedReason,
    parentExecutionId: row.parentExecutionId,
    delegationDepth: row.delegationDepth,
    delegatedToProfileId: row.delegatedToProfileId,
    delegationChain: stringArray(row.delegationChain),
    delegationPayload: record(row.delegationPayload),
    approval: row.approval ?? null,
    resultSummary: row.resultSummary,
    updatedAt: row.updatedAt.toISOString()
  });
}

export function eventDto(row: EventRow): AgentHubEvent {
  return {
    id: row.id, workspaceId: row.workspaceId, executionId: row.executionId,
    revision: row.revision, action: row.action, actorId: row.actorId,
    data: record(row.data), at: row.at.toISOString()
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
