import type { EntityEditSnapshot } from "../../common/public/entity-edit-snapshot";
import type { Prisma } from "@prisma/client";

/** Project fence projection. Does not change existing trash/archive policy. */
export abstract class NoteAgentReferences {
  abstract referenceTx(tx: Prisma.TransactionClient, workspaceId: string, id: string): Promise<{ projectId: string | null } | null>;
  abstract snapshotTx(tx: Prisma.TransactionClient, workspaceId: string, id: string): Promise<EntityEditSnapshot | null>;
}
