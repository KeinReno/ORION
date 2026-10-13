import { Injectable, NotFoundException } from "@nestjs/common";
import type { Contact as ContactRow, Prisma } from "@prisma/client";
import type { ContactCard, CreateContactCardInput, UpdateContactCardInput } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { assertHomeInWorkspace } from "../home/home-refs.util";
import { WorkspacesService } from "../workspaces/workspaces.service";

/**
 * Module «Контакты». Mirrors notes/lists: membership first, everything inside
 * `withUser`, DTOs assembled by hand. It shares the `contacts` table with «Дом»
 * (a home's contacts are the rows with its `homeId`); this service sees every
 * contact of the workspace, Home's own endpoints stay home-scoped.
 */
@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async list(userId: string, workspaceId: string): Promise<ContactCard[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.contact.findMany({ where: { workspaceId }, orderBy: [{ name: "asc" }, { createdAt: "asc" }] });
    });
    return rows.map(toDto);
  }

  async get(userId: string, workspaceId: string, contactId: string): Promise<ContactCard> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return this.assertOwnedTx(tx, workspaceId, contactId);
    });
    return toDto(row);
  }

  async create(userId: string, workspaceId: string, input: CreateContactCardInput): Promise<ContactCard> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      if (input.homeId) await assertHomeInWorkspace(tx, workspaceId, input.homeId);
      return tx.contact.create({
        data: {
          workspaceId,
          homeId: input.homeId ?? null,
          name: input.name,
          role: input.role,
          phone: input.phone,
          email: input.email,
          note: input.note
        }
      });
    });
    return toDto(row);
  }

  async update(userId: string, workspaceId: string, contactId: string, input: UpdateContactCardInput): Promise<ContactCard> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, contactId);
      if (input.homeId) await assertHomeInWorkspace(tx, workspaceId, input.homeId);
      return tx.contact.update({
        where: { id: contactId },
        data: { name: input.name, role: input.role, phone: input.phone, email: input.email, note: input.note, homeId: input.homeId }
      });
    });
    return toDto(row);
  }

  /**
   * A real delete (a contact carries no history worth archiving). Links and
   * reminders pointing at it stay as rows and resolve to a safe "недоступно"
   * placeholder, the same as for any deleted entity.
   */
  async remove(userId: string, workspaceId: string, contactId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, contactId);
      await tx.contact.delete({ where: { id: contactId } });
    });
  }

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, contactId: string): Promise<ContactRow> {
    const contact = await tx.contact.findUnique({ where: { id: contactId } });
    if (!contact || contact.workspaceId !== workspaceId) throw new NotFoundException("Контакт не найден");
    return contact;
  }
}

function toDto(row: ContactRow): ContactCard {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    homeId: row.homeId,
    name: row.name,
    role: row.role,
    phone: row.phone,
    email: row.email,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
