import type { Prisma } from "@prisma/client";
import type { Contact, CreateContactInput, UpdateContactInput } from "@orion/shared-types";

/** Contact side of the existing Home routes; caller retains membership/home policy. */
export abstract class HomeContactCommands {
  abstract listTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string): Promise<Contact[]>;
  abstract createTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string, input: CreateContactInput): Promise<Contact>;
  abstract updateTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string, contactId: string, input: UpdateContactInput): Promise<Contact>;
  abstract removeTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string, contactId: string): Promise<void>;
}
