import { Global, Injectable, Module } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/** Public transaction-scoped extension point. Core does not know which domains must revoke authority. */
export interface CapabilityChange { kind: "module" | "plugin"; id: string; enabled: boolean; workspaceId: string; actorId: string }
type Handler = (tx: Prisma.TransactionClient, change: CapabilityChange) => Promise<void>;
@Injectable()
export class CapabilityLifecycle {
  private readonly handlers = new Map<string, Handler>();
  register(id: string, handler: Handler): void {
    if (this.handlers.has(id)) throw new Error(`Duplicate capability lifecycle contribution: ${id}`);
    this.handlers.set(id, handler);
  }
  async changedTx(tx: Prisma.TransactionClient, change: CapabilityChange): Promise<void> {
    for (const handler of this.handlers.values()) await handler(tx, change);
  }
}
@Global()
@Module({ providers: [CapabilityLifecycle], exports: [CapabilityLifecycle] })
export class CapabilityLifecycleModule {}
