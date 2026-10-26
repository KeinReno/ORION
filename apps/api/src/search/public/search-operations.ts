import type { Prisma } from "@prisma/client";
import type { SearchableEntityType, GlobalSearchResult, CreateEntityLinkInput, EntityLink } from "@orion/shared-types";

/** Typed search/link operations over registered owner providers. */
export abstract class SearchOperations {
  abstract search(userId: string, workspaceId: string, query: string, allowedTypes?: readonly SearchableEntityType[]): Promise<GlobalSearchResult[]>;
  abstract createLink(userId: string, workspaceId: string, input: CreateEntityLinkInput): Promise<EntityLink>;
  abstract createLinkTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, input: CreateEntityLinkInput): Promise<EntityLink>;
  abstract removeLink(userId: string, workspaceId: string, linkId: string): Promise<void>;
}
