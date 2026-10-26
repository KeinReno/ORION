import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, Contact as ContactRow } from "@prisma/client";
import type { CreateContactInput, UpdateContactInput, Contact } from "@orion/shared-types";
import { HomeContactCommands } from "./public/home-contact-commands";

@Injectable()
export class HomeContactWrites extends HomeContactCommands {
  async listTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string) {
    return (await tx.contact.findMany({ where: { workspaceId, homeId, archivedAt: null }, orderBy: { name: "asc" } })).map(toHomeContact);
  }
  async createTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string, input: CreateContactInput) {
    return toHomeContact(await tx.contact.create({ data: { workspaceId, homeId, name: input.name, role: input.role, phone: input.phone, note: input.note } }));
  }
  async updateTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string, contactId: string, input: UpdateContactInput) {
    await this.assertContactTx(tx, workspaceId, homeId, contactId);
    return toHomeContact(await tx.contact.update({ where: { id: contactId }, data: {
      ...(input.name !== undefined ? { name: input.name } : {}), ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.phone !== undefined ? { phone: input.phone, phones: input.phone ? [{ label: "", value: input.phone }] : [] } : {}),
      ...(input.note !== undefined ? { note: input.note } : {})
    } }));
  }
  async removeTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string, contactId: string) {
    await this.assertContactTx(tx, workspaceId, homeId, contactId);
    await tx.contact.delete({ where: { id: contactId } });
  }
  private async assertContactTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string, contactId: string) {
    const contact = await tx.contact.findUnique({ where: { id: contactId } });
    if (!contact || contact.workspaceId !== workspaceId || contact.homeId !== homeId) throw new NotFoundException("Контакт не найден");
  }
}
function toHomeContact(row: ContactRow): Contact {
  return { id: row.id, homeId: row.homeId ?? "", name: row.name, role: row.role, phone: row.phone, note: row.note };
}
