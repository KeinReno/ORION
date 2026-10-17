import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/** Public extension point: a delegation owner rechecks its live authority in the runner transaction. */
export interface ExecutionAuthorityContext {
  reference: string; workspaceId: string; ownerUserId: string; connectionId: string; profileId: string;
}
export type ExecutionAuthorityCheck = (tx: Prisma.TransactionClient, context: ExecutionAuthorityContext) => Promise<string | null>;

@Injectable()
export class ExecutionAuthorityRegistry {
  private readonly checks = new Map<string, ExecutionAuthorityCheck>();
  register(namespace: string, check: ExecutionAuthorityCheck): void {
    if (!/^[a-z][a-z0-9-]*$/.test(namespace) || this.checks.has(namespace)) throw new Error(`Invalid or duplicate execution authority: ${namespace}`);
    this.checks.set(namespace, check);
  }
  async checkTx(tx: Prisma.TransactionClient, context: ExecutionAuthorityContext): Promise<string | null> {
    const check = this.checks.get(context.reference.split(":")[0]);
    if (!check) return "delegation_authority_unavailable";
    // A missing/disabled provider never turns delegated execution into a manual grant.
    try { return await check(tx, context); } catch { return "delegation_authority_unavailable"; }
  }
}
