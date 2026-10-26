import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ContactReferences } from "./public/contact-references";

/** Contacts owns this query; .service.ts keeps model access under architecture-check. */
@Injectable()
export class ContactReferenceReader extends ContactReferences {
  async existsTx(tx: Prisma.TransactionClient, workspaceId: string, contactId: string): Promise<boolean> {
    const contact = await tx.contact.findFirst({ where: { id: contactId, workspaceId }, select: { id: true } });
    return contact !== null;
  }
}
