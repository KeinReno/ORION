import type { Prisma } from "@prisma/client";
import type { Attempt } from "@orion/shared-types";

/**
 * Public v1 boundary for the manager. It can queue an approved send on behalf of a policy and stop the policy's pending work;
 * it cannot reserve, claim or report. Every executor check (hash, blockers, one live attempt per vacancy, reserve, budget) still applies.
 */
export const EXECUTION_AUTOMATION_PORT = Symbol("OPPORTUNITY_EXECUTION_AUTOMATION_PORT.v1");
export interface ExecutionAutomationPort {
  queueByPolicyTx(tx: Prisma.TransactionClient, ownerUserId: string, workspaceId: string, input: { connectionId: string; draftId: string; policyRef: string; idempotencyKey: string; ttlMinutes: number }): Promise<Attempt>;
  cancelByPolicyTx(tx: Prisma.TransactionClient, workspaceId: string, policyRef: string, note: string): Promise<number>;
  statsByPolicyTx(tx: Prisma.TransactionClient, workspaceId: string, policyRef: string): Promise<Record<string, number>>;
}
