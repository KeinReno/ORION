import type { Prisma } from "@prisma/client";
import type { Draft, DryRun } from "@orion/shared-types";

/** Public v1 read boundary for the execution plugin: the current dry run of a draft and its state. Read-only; it never approves anything. */
export const ASSISTANT_DRAFT_PORT = Symbol("OPPORTUNITY_ASSISTANT_DRAFT_PORT.v1");
export interface AssistantDraftPort {
  /** Membership and the enabled assistant plugin are checked in the caller's transaction; the draft must belong to this workspace. */
  readForExecutionTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, draftId: string): Promise<{ draft: Draft; dryRun: DryRun }>;
}
