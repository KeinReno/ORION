import type { Prisma } from "@prisma/client";
import type { CreateEntityLinkInput, EntityLink, SearchableEntityType } from "@orion/shared-types";

/**
 * Public SDK contract of the core entity-links layer (task 01.1). A module that creates a link
 * inside its own write transaction, or that deletes its entity and must cascade the links, depends
 * on this type only — not on EntityLinksService internals and never on the entity_links table.
 */
export abstract class EntityLinkOperations {
  abstract createLinkTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, input: CreateEntityLinkInput): Promise<EntityLink>;
  abstract removeForEntityTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    type: SearchableEntityType,
    id: string,
    actorId?: string | null
  ): Promise<number>;
}
