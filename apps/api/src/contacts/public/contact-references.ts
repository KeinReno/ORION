import type { Prisma } from "@prisma/client";

/** Read-only reference contract. Caller authorizes its command and supplies the
 * existing transaction/RLS context. No contact details or extra authority. */
export abstract class ContactReferences {
  abstract existsTx(tx: Prisma.TransactionClient, workspaceId: string, contactId: string): Promise<boolean>;
}
