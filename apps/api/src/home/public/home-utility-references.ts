import type { Prisma } from "@prisma/client";

/** Utility references only; no authorization grant, no lifecycle or tariff queries. */
export abstract class HomeUtilityReferences {
  abstract activeHomeTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string): Promise<boolean>;
  abstract electricityMeterTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string, meterId: string): Promise<boolean>;
}
