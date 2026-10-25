import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Contact as ContactRow, ContactInteraction as InteractionRow, Prisma } from "@prisma/client";
import {
  canonicalizeEndpoints,
  findContactDuplicates,
  mergeContactFields,
  normalizeChannels,
  normalizeTags,
  type BulkContactsInput,
  type BulkContactsResult,
  type ContactCard,
  type ContactChannel,
  type ContactInteraction,
  type ContactRelation,
  type CreateContactCardInput,
  type CreateContactInteractionInput,
  type CreateContactRelationInput,
  type ImportContactsInput,
  type ImportContactsResult,
  type MergeContactsInput,
  type RelationKind,
  type SearchableEntityType,
  type UpdateContactCardInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { assertHomeInWorkspace } from "../home/home-refs.util";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { EntityReferenceRegistry } from "../common/entity-reference-registry";

const INTERACTIONS_LIMIT = 200;

/**
 * Module «Контакты». Mirrors notes/lists: membership first, everything inside
 * `withUser`, DTOs assembled by hand. It shares the `contacts` table with «Дом»
 * (a home's contacts are the rows with its `homeId`); this service sees every
 * contact of the workspace, Home's own endpoints stay home-scoped.
 *
 * Primary `phone`/`email` and the full `phones`/`emails` lists are kept in sync
 * here (`fieldsFromInput`): a list write makes its first value the primary one,
 * a lone primary write (older clients, «Дом») replaces the list with that value.
 */
@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly references: EntityReferenceRegistry
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
      return tx.contact.create({ data: { ...fieldsFromInput(input), workspaceId, name: input.name } as Prisma.ContactUncheckedCreateInput });
    });
    return toDto(row);
  }

  async update(userId: string, workspaceId: string, contactId: string, input: UpdateContactCardInput): Promise<ContactCard> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const existing = await this.assertOwnedTx(tx, workspaceId, contactId);
      if (input.homeId) await assertHomeInWorkspace(tx, workspaceId, input.homeId);
      return tx.contact.update({ where: { id: contactId }, data: fieldsFromInput(input, existing) });
    });
    return toDto(row);
  }

  /**
   * A real delete (a contact carries no history worth archiving — archiving is
   * the soft way out). Links and reminders pointing at it stay as rows and
   * resolve to a safe "недоступно" placeholder, the same as for any deleted
   * entity; the journal and relations go with it (cascade).
   */
  async remove(userId: string, workspaceId: string, contactId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, contactId);
      await tx.contact.delete({ where: { id: contactId } });
    });
  }

  // ------------------------------------------------------------------ bulk

  async bulk(userId: string, workspaceId: string, input: BulkContactsInput): Promise<BulkContactsResult> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const where = { id: { in: input.ids }, workspaceId };
      switch (input.action) {
        case "delete":
          return { affected: (await tx.contact.deleteMany({ where })).count };
        case "archive":
          return { affected: (await tx.contact.updateMany({ where: { ...where, archivedAt: null }, data: { archivedAt: new Date() } })).count };
        case "restore":
          return { affected: (await tx.contact.updateMany({ where, data: { archivedAt: null } })).count };
        case "favorite":
          return { affected: (await tx.contact.updateMany({ where, data: { favorite: true } })).count };
        case "unfavorite":
          return { affected: (await tx.contact.updateMany({ where, data: { favorite: false } })).count };
        case "addTag":
        case "removeTag": {
          const tag = input.tag as string;
          const key = tag.toLocaleLowerCase("ru");
          const rows = await tx.contact.findMany({ where, select: { id: true, tags: true } });
          let affected = 0;
          for (const row of rows) {
            const has = row.tags.some((existing) => existing.toLocaleLowerCase("ru") === key);
            if (input.action === "addTag" ? has : !has) continue;
            const tags = input.action === "addTag" ? normalizeTags([...row.tags, tag]) : row.tags.filter((existing) => existing.toLocaleLowerCase("ru") !== key);
            await tx.contact.update({ where: { id: row.id }, data: { tags } });
            affected += 1;
          }
          return { affected };
        }
      }
    });
  }

  // ---------------------------------------------------------------- import

  /** Creates the rows (already parsed from vCard/CSV by the client); with `skipDuplicates`, rows resembling an existing or earlier row are skipped. */
  async importMany(userId: string, workspaceId: string, input: ImportContactsInput): Promise<ImportContactsResult> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      for (const homeId of new Set(input.items.map((item) => item.homeId).filter((id): id is string => Boolean(id)))) {
        await assertHomeInWorkspace(tx, workspaceId, homeId);
      }
      const skip = new Set<number>();
      if (input.skipDuplicates) {
        const existing = (await tx.contact.findMany({ where: { workspaceId } })).map(toDto);
        const incoming = input.items.map((item, index) => ({ ...fieldsToCard(item), id: `import:${index}` }));
        for (const group of findContactDuplicates([...existing, ...incoming])) {
          // The first member of a group is the one that stays; every later *incoming* row is a repeat.
          const order = new Map([...existing, ...incoming].map((card, position) => [card.id, position]));
          const [, ...repeats] = [...group.ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
          for (const id of repeats) if (id.startsWith("import:")) skip.add(Number(id.slice(7)));
        }
      }
      const data = input.items.filter((_, index) => !skip.has(index)).map((item) => ({ ...fieldsFromInput(item), workspaceId, name: item.name }) as Prisma.ContactCreateManyInput);
      if (data.length > 0) await tx.contact.createMany({ data });
      return { created: data.length, skipped: skip.size };
    });
  }

  // ----------------------------------------------------------------- merge

  /** Folds `sourceIds` into the contact: data, journal, relations, links and reminders move over; the sources are deleted. */
  async merge(userId: string, workspaceId: string, contactId: string, input: MergeContactsInput): Promise<ContactCard> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const target = await this.assertOwnedTx(tx, workspaceId, contactId);
      const sourceIds = [...new Set(input.sourceIds)].filter((id) => id !== contactId);
      if (sourceIds.length === 0) throw new BadRequestException("Выберите другие контакты для объединения");
      const sources = await tx.contact.findMany({ where: { id: { in: sourceIds }, workspaceId } });
      if (sources.length !== sourceIds.length) throw new NotFoundException("Контакт не найден");

      const fields = mergeContactFields(toDto(target), sources.map(toDto));
      const lastContactedAt = [target, ...sources].reduce<Date | null>((latest, contact) => (contact.lastContactedAt && (!latest || contact.lastContactedAt > latest) ? contact.lastContactedAt : latest), null);

      await tx.contactInteraction.updateMany({ where: { contactId: { in: sourceIds } }, data: { contactId } });

      // Relations: re-create each source's relation against the target (skipping ones that would point at itself).
      const relations = await tx.contactRelation.findMany({ where: { OR: [{ contactAId: { in: sourceIds } }, { contactBId: { in: sourceIds } }] } });
      for (const relation of relations) {
        const sourceIsA = sourceIds.includes(relation.contactAId);
        const other = sourceIsA ? relation.contactBId : relation.contactAId;
        if (other === contactId || sourceIds.includes(other)) continue;
        const [a, b] = orderedPair(contactId, other);
        await tx.contactRelation.upsert({
          where: { contactAId_contactBId: { contactAId: a, contactBId: b } },
          create: { workspaceId, contactAId: a, contactBId: b, label: relation.label },
          update: {}
        });
      }

      await this.repointEntityLinksTx(tx, workspaceId, sourceIds, contactId);
      await tx.entityReminder.updateMany({ where: { workspaceId, entityType: "contact", entityId: { in: sourceIds } }, data: { entityId: contactId } });
      await this.references.moveTx(tx, { workspaceId, entityType: "contact", fromIds: sourceIds, toId: contactId });

      await tx.contact.deleteMany({ where: { id: { in: sourceIds }, workspaceId } });
      return tx.contact.update({ where: { id: contactId }, data: { ...fieldsFromInput(fields, target), lastContactedAt } });
    });
    return toDto(row);
  }

  /** Moves `entity_links` of the merged contacts onto the survivor, dropping the ones that would now repeat. */
  private async repointEntityLinksTx(tx: Prisma.TransactionClient, workspaceId: string, sourceIds: string[], targetId: string): Promise<void> {
    const links = await tx.entityLink.findMany({
      where: { workspaceId, OR: [{ sourceType: "contact", sourceId: { in: sourceIds } }, { targetType: "contact", targetId: { in: sourceIds } }] }
    });
    for (const link of links) {
      const source = link.sourceType === "contact" && sourceIds.includes(link.sourceId) ? { type: "contact" as SearchableEntityType, id: targetId } : { type: link.sourceType as SearchableEntityType, id: link.sourceId };
      const target = link.targetType === "contact" && sourceIds.includes(link.targetId) ? { type: "contact" as SearchableEntityType, id: targetId } : { type: link.targetType as SearchableEntityType, id: link.targetId };
      const next = canonicalizeEndpoints(link.kind as RelationKind, source, target);
      const clash = await tx.entityLink.findFirst({
        where: { sourceType: next.source.type, sourceId: next.source.id, targetType: next.target.type, targetId: next.target.id, kind: link.kind, NOT: { id: link.id } },
        select: { id: true }
      });
      if (clash) await tx.entityLink.delete({ where: { id: link.id } });
      else await tx.entityLink.update({ where: { id: link.id }, data: { sourceType: next.source.type, sourceId: next.source.id, targetType: next.target.type, targetId: next.target.id } });
    }
  }

  // ----------------------------------------------------------- interactions

  async listInteractions(userId: string, workspaceId: string, contactId: string): Promise<ContactInteraction[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, contactId);
      return tx.contactInteraction.findMany({ where: { workspaceId, contactId }, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }], take: INTERACTIONS_LIMIT });
    });
    return rows.map(interactionDto);
  }

  /** Logs a call/meeting/…; the contact's `lastContactedAt` moves to it when it is the latest one that has already happened. */
  async createInteraction(userId: string, workspaceId: string, contactId: string, input: CreateContactInteractionInput): Promise<ContactInteraction> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const contact = await this.assertOwnedTx(tx, workspaceId, contactId);
      const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
      const created = await tx.contactInteraction.create({ data: { workspaceId, contactId, kind: input.kind, note: input.note, occurredAt } });
      if (occurredAt <= new Date() && (!contact.lastContactedAt || occurredAt > contact.lastContactedAt)) {
        await tx.contact.update({ where: { id: contactId }, data: { lastContactedAt: occurredAt } });
      }
      return created;
    });
    return interactionDto(row);
  }

  async removeInteraction(userId: string, workspaceId: string, contactId: string, interactionId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, contactId);
      const found = await tx.contactInteraction.findUnique({ where: { id: interactionId } });
      if (!found || found.workspaceId !== workspaceId || found.contactId !== contactId) throw new NotFoundException("Запись не найдена");
      await tx.contactInteraction.delete({ where: { id: interactionId } });
      const latest = await tx.contactInteraction.findFirst({ where: { contactId, occurredAt: { lte: new Date() } }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } });
      await tx.contact.update({ where: { id: contactId }, data: { lastContactedAt: latest?.occurredAt ?? null } });
    });
  }

  // -------------------------------------------------------------- relations

  async listRelations(userId: string, workspaceId: string, contactId: string): Promise<ContactRelation[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, contactId);
      const rows = await tx.contactRelation.findMany({
        where: { workspaceId, OR: [{ contactAId: contactId }, { contactBId: contactId }] },
        include: { contactA: { select: { name: true } }, contactB: { select: { name: true } } },
        orderBy: { createdAt: "asc" }
      });
      return rows.map((row) => relationDto(row, contactId));
    });
  }

  /** Relates two contacts of this workspace; repeating the pair only renames the label. */
  async createRelation(userId: string, workspaceId: string, contactId: string, input: CreateContactRelationInput): Promise<ContactRelation> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, contactId);
      if (input.otherId === contactId) throw new BadRequestException("Нельзя связать контакт с самим собой");
      await this.assertOwnedTx(tx, workspaceId, input.otherId);
      const [a, b] = orderedPair(contactId, input.otherId);
      const row = await tx.contactRelation.upsert({
        where: { contactAId_contactBId: { contactAId: a, contactBId: b } },
        create: { workspaceId, contactAId: a, contactBId: b, label: input.label },
        update: { label: input.label },
        include: { contactA: { select: { name: true } }, contactB: { select: { name: true } } }
      });
      return relationDto(row, contactId);
    });
  }

  async removeRelation(userId: string, workspaceId: string, contactId: string, relationId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, contactId);
      const found = await tx.contactRelation.findUnique({ where: { id: relationId } });
      if (!found || found.workspaceId !== workspaceId || (found.contactAId !== contactId && found.contactBId !== contactId)) throw new NotFoundException("Связь не найдена");
      await tx.contactRelation.delete({ where: { id: relationId } });
    });
  }

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, contactId: string): Promise<ContactRow> {
    const contact = await tx.contact.findUnique({ where: { id: contactId } });
    if (!contact || contact.workspaceId !== workspaceId) throw new NotFoundException("Контакт не найден");
    return contact;
  }
}

function orderedPair(first: string, second: string): [string, string] {
  return first < second ? [first, second] : [second, first];
}

/**
 * Column values for a create/update. Only what the input mentions is written;
 * the primary phone/email follow their lists (see the class comment).
 */
function fieldsFromInput(input: UpdateContactCardInput, existing?: ContactRow): Prisma.ContactUncheckedUpdateInput {
  const data: Prisma.ContactUncheckedUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.kind !== undefined) data.kind = input.kind;
  if (input.organization !== undefined) data.organization = input.organization;
  if (input.role !== undefined) data.role = input.role;
  if (input.address !== undefined) data.address = input.address;
  if (input.note !== undefined) data.note = input.note;
  if (input.homeId !== undefined) data.homeId = input.homeId;
  if (input.favorite !== undefined) data.favorite = input.favorite;
  if (input.contactEveryDays !== undefined) data.contactEveryDays = input.contactEveryDays;
  if (input.tags !== undefined) data.tags = normalizeTags(input.tags);
  if (input.birthday !== undefined) data.birthday = input.birthday === null ? null : new Date(`${input.birthday}T00:00:00.000Z`);
  if (input.links !== undefined) data.links = normalizeChannels(input.links) as unknown as Prisma.InputJsonValue;
  if (input.archived !== undefined) data.archivedAt = input.archived ? (existing?.archivedAt ?? new Date()) : null;

  if (input.phones !== undefined) {
    const phones = normalizeChannels(input.phones, "phone");
    data.phones = phones as unknown as Prisma.InputJsonValue;
    data.phone = phones[0]?.value ?? "";
  } else if (input.phone !== undefined) {
    data.phone = input.phone;
    data.phones = (input.phone ? [{ label: "", value: input.phone }] : []) as unknown as Prisma.InputJsonValue;
  }
  if (input.emails !== undefined) {
    const emails = normalizeChannels(input.emails);
    data.emails = emails as unknown as Prisma.InputJsonValue;
    data.email = emails[0]?.value ?? "";
  } else if (input.email !== undefined) {
    data.email = input.email;
    data.emails = (input.email ? [{ label: "", value: input.email }] : []) as unknown as Prisma.InputJsonValue;
  }
  return data;
}

/** The slice of a card the duplicate finder looks at, for a row that is not stored yet. */
function fieldsToCard(item: CreateContactCardInput): Pick<ContactCard, "name" | "kind" | "phone" | "email" | "phones" | "emails" | "archivedAt"> {
  const phones = item.phones !== undefined ? normalizeChannels(item.phones, "phone") : item.phone ? [{ label: "", value: item.phone }] : [];
  const emails = item.emails !== undefined ? normalizeChannels(item.emails) : item.email ? [{ label: "", value: item.email }] : [];
  return { name: item.name, kind: item.kind, phone: phones[0]?.value ?? "", email: emails[0]?.value ?? "", phones, emails, archivedAt: null };
}

function parseChannels(value: Prisma.JsonValue): ContactChannel[] {
  if (!Array.isArray(value)) return [];
  const out: ContactChannel[] = [];
  for (const item of value) {
    if (item && typeof item === "object" && !Array.isArray(item) && typeof item.value === "string") {
      out.push({ label: typeof item.label === "string" ? item.label : "", value: item.value });
    }
  }
  return out;
}

function toDto(row: ContactRow): ContactCard {
  const phones = parseChannels(row.phones);
  const emails = parseChannels(row.emails);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    homeId: row.homeId,
    kind: row.kind === "organization" ? "organization" : "person",
    name: row.name,
    organization: row.organization,
    role: row.role,
    phone: row.phone,
    email: row.email,
    // Rows written by «Дом» (or before lists existed) only have the primary value.
    phones: phones.length > 0 ? phones : row.phone ? [{ label: "", value: row.phone }] : [],
    emails: emails.length > 0 ? emails : row.email ? [{ label: "", value: row.email }] : [],
    links: parseChannels(row.links),
    address: row.address,
    birthday: row.birthday ? row.birthday.toISOString().slice(0, 10) : null,
    tags: row.tags,
    favorite: row.favorite,
    contactEveryDays: row.contactEveryDays,
    lastContactedAt: row.lastContactedAt ? row.lastContactedAt.toISOString() : null,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function interactionDto(row: InteractionRow): ContactInteraction {
  return {
    id: row.id,
    contactId: row.contactId,
    kind: (["call", "message", "meeting", "email"] as const).find((kind) => kind === row.kind) ?? "other",
    note: row.note,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString()
  };
}

function relationDto(
  row: { id: string; contactAId: string; contactBId: string; label: string; contactA: { name: string }; contactB: { name: string } },
  viewerId: string
): ContactRelation {
  const viewerIsA = row.contactAId === viewerId;
  return {
    id: row.id,
    otherId: viewerIsA ? row.contactBId : row.contactAId,
    otherName: viewerIsA ? row.contactB.name : row.contactA.name,
    label: row.label
  };
}
