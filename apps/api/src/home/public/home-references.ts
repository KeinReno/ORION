import type { Prisma } from "@prisma/client";

/** Existence only; archived references retain the existing capture policy. */
export abstract class HomeReferences {
  abstract existsTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string): Promise<boolean>;
}
