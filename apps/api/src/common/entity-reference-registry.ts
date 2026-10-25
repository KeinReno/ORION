import { Module, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { SearchableEntityType } from "@orion/shared-types";

export interface EntityReferenceMove {
  workspaceId: string;
  entityType: SearchableEntityType;
  fromIds: readonly string[];
  toId: string;
}

/** Public synchronous extension point. Caller authorizes the command; owners write only their own references. */
@Injectable()
export class EntityReferenceRegistry {
  private readonly handlers = new Map<string, (tx: Prisma.TransactionClient, move: EntityReferenceMove) => Promise<void>>();
  register(owner: string, handler: (tx: Prisma.TransactionClient, move: EntityReferenceMove) => Promise<void>): void {
    if (this.handlers.has(owner)) throw new Error(`Duplicate reference-move owner: ${owner}`);
    this.handlers.set(owner, handler);
  }
  unregister(owner: string): void { this.handlers.delete(owner); }
  async moveTx(tx: Prisma.TransactionClient, move: EntityReferenceMove): Promise<void> {
    for (const handler of this.handlers.values()) await handler(tx, move);
  }
}

@Module({ providers: [EntityReferenceRegistry], exports: [EntityReferenceRegistry] })
export class EntityReferenceRegistryModule {}
