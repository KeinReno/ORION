import type { Prisma } from "@prisma/client";
import type { Assessment, Draft } from "@orion/shared-types";

/**
 * Public v1 boundary for the manager: assess, build a draft and approve it on behalf of a policy.
 * The caller must be the workspace owner acting inside its own transaction; approval is refused unless every section rests on
 * confirmed facts or is plain template text, the data is fresh and nothing was edited by hand.
 */
export const ASSISTANT_AUTOMATION_PORT = Symbol("OPPORTUNITY_ASSISTANT_AUTOMATION_PORT.v1");
export interface AssistantAutomationPort {
  assessTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, opportunityId: string, profileId: string): Promise<Assessment>;
  createResponseDraftTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, opportunityId: string, profileId: string, kind: "response" | "proposal"): Promise<Draft>;
  /** `approverRef` is recorded as the approver (for example `policy:<id>`), so a person's approval is never mistaken for a delegated one. */
  approveForPolicyTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, draftId: string, approverRef: string): Promise<Draft>;
}
