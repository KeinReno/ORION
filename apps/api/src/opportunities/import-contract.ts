import type { Prisma } from "@prisma/client";
import type { CreateOpportunityInput } from "@orion/shared-types";

/** Public v1 import boundary. A registered adapter cannot overwrite an existing manual card. */
export const OPPORTUNITIES_IMPORT_PORT = Symbol("OPPORTUNITIES_IMPORT_PORT.v1");
export interface OpportunitiesImportPort {
  assertOpportunityTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, id: string): Promise<void>;
  captureOpportunityTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, input: CreateOpportunityInput): Promise<{ id: string; created: boolean }>;
  resolveExternalTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, sourceType: string, externalId: string): Promise<string | null>;
}
