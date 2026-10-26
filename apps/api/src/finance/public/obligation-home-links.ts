import type { Prisma } from "@prisma/client";

/** Home association operations owned by finance; no change to caller access policy. */
export abstract class ObligationHomeLinks {
  abstract atHomeTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string): Promise<Array<{ id: string; closedAt: Date | null }>>;
  abstract elsewhereTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string): Promise<Array<{ id: string }>>;
  abstract setHomeTx(tx: Prisma.TransactionClient, workspaceId: string, id: string, homeId: string | null, requiredHomeId?: string): Promise<number>;
}
