import type { Prisma } from "@prisma/client";
import type { EntityEditSnapshot } from "../../common/public/entity-edit-snapshot";

export abstract class TaskProposalReader {
  abstract snapshotTx(tx: Prisma.TransactionClient, workspaceId: string, id: string): Promise<EntityEditSnapshot | null>;
}
