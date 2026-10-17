import type { Prisma } from "@prisma/client";
import type { Opportunity } from "@orion/shared-types";

/** Public v1 read boundary for extensions (assistant, manager). Read-only: an extension never writes cards through it. */
export const OPPORTUNITIES_READ_PORT = Symbol("OPPORTUNITIES_READ_PORT.v1");
export interface OpportunitiesReadPort {
  /** Membership + enabled Base module are checked in the caller's transaction; the card must belong to this workspace. */
  readTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, id: string): Promise<Opportunity>;
  /** Non-archived cards of one source in the given statuses, oldest id first (stable order), for batch processing. */
  listCandidatesTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, filter: { sourceType: string; statuses: string[]; limit: number; afterId?: string }): Promise<Opportunity[]>;
}
