import type { AgentFinanceRefs, AgentFinanceDraftInput, FinanceDraft } from "@orion/shared-types";

export interface DraftAuthor { userId: string; workspaceId: string; tokenId: string; tokenName: string }
/** Receipt proposals only: a draft does not post money. */
export abstract class AgentDraftOperations {
  abstract refs(userId: string, workspaceId: string): Promise<AgentFinanceRefs>;
  abstract createFromAgent(author: DraftAuthor, input: AgentFinanceDraftInput): Promise<FinanceDraft>;
}
