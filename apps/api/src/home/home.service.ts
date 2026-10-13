import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Contact as ContactRow, Home as HomeRow, Meter as MeterRow, MeterReading as ReadingRow, Prisma } from "@prisma/client";
import {
  METER_KIND_UNIT,
  homeKindSchema,
  isTaskClosed,
  meterKindSchema,
  readingProblem,
  withConsumption,
  type ActivityEntry,
  type AttachToHomeInput,
  type Contact,
  type CreateContactInput,
  type CreateHomeInput,
  type CreateMeterInput,
  type CreateMeterReadingInput,
  type Home,
  type HomeOverview,
  type Meter,
  type UpdateContactInput,
  type UpdateHomeInput,
  type UpdateMeterInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

const STATUS_RU: Record<string, string> = { backlog: "Бэклог", todo: "К выполнению", in_progress: "В работе", done: "Готово", canceled: "Отменено" };
const READINGS_SHOWN = 12;
/** Closed chores stay on the page for this long, so "what did we do lately" is visible. */
const DONE_VISIBLE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Module «Дом»: homes, meters with readings, contacts, and the overview that ties the other
 * modules' records to a home. The four attachable record types keep living in their own modules;
 * here they are only found by `homeId` and re-pointed by attach / detach.
 */
@Injectable()
export class HomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService
  ) {}

  // ----------------------------------------------------------------- homes

  async list(userId: string, workspaceId: string, archived = false): Promise<Home[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.home.findMany({ where: { workspaceId, archivedAt: archived ? { not: null } : null }, orderBy: { createdAt: "asc" } });
    });
    return rows.map(homeDto);
  }

  async create(userId: string, workspaceId: string, input: CreateHomeInput): Promise<Home> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertNameFreeTx(tx, workspaceId, input.name, null);
      return tx.home.create({ data: { workspaceId, name: input.name, kind: input.kind, note: input.note } });
    });
    return homeDto(row);
  }

  async update(userId: string, workspaceId: string, homeId: string, input: UpdateHomeInput): Promise<Home> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertHomeTx(tx, workspaceId, homeId);
      if (input.name !== undefined) await this.assertNameFreeTx(tx, workspaceId, input.name, homeId);
      return tx.home.update({
        where: { id: homeId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(input.archivedAt !== undefined ? { archivedAt: input.archivedAt === null ? null : new Date(input.archivedAt) } : {})
        }
      });
    });
    return homeDto(row);
  }

  /** Meters, readings and contacts go with the home; chores, lists, things and payments only lose the link. */
  async remove(userId: string, workspaceId: string, homeId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertHomeTx(tx, workspaceId, homeId);
      await tx.home.delete({ where: { id: homeId } });
    });
  }

  // -------------------------------------------------------------- overview

  async overview(userId: string, workspaceId: string, homeId: string): Promise<HomeOverview> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const home = await this.assertHomeTx(tx, workspaceId, homeId);
      // Only what the viewer may open: a restricted or switched-off module contributes nothing here.
      const accessible = await this.modules.accessibleSetTx(tx, userId, workspaceId);
      const since = new Date(Date.now() - DONE_VISIBLE_MS);

      const [tasks, lists, items, obligations, meters, contacts] = await Promise.all([
        accessible.has("tasks")
          ? tx.task.findMany({ where: { workspaceId, homeId }, select: { id: true, status: true, updatedAt: true }, take: 500 })
          : Promise.resolve([]),
        accessible.has("lists") ? tx.list.findMany({ where: { workspaceId, homeId, archivedAt: null }, select: { id: true } }) : Promise.resolve([]),
        accessible.has("inventory")
          ? tx.inventoryItem.findMany({ where: { workspaceId, homeId, archivedAt: null }, select: { id: true } })
          : Promise.resolve([]),
        accessible.has("finance")
          ? tx.financeObligation.findMany({ where: { workspaceId, homeId }, select: { id: true, closedAt: true } })
          : Promise.resolve([]),
        tx.meter.findMany({ where: { workspaceId, homeId }, orderBy: { createdAt: "asc" } }),
        tx.contact.findMany({ where: { workspaceId, homeId }, orderBy: { name: "asc" } })
      ]);

      const elsewhere = { homeId: { not: null as string | null, notIn: [homeId] }, workspaceId };
      const [otherTasks, otherLists, otherItems, otherBills] = await Promise.all([
        accessible.has("tasks") ? tx.task.findMany({ where: elsewhere, select: { id: true } }) : Promise.resolve([]),
        accessible.has("lists") ? tx.list.findMany({ where: { ...elsewhere, archivedAt: null }, select: { id: true } }) : Promise.resolve([]),
        accessible.has("inventory") ? tx.inventoryItem.findMany({ where: { ...elsewhere, archivedAt: null }, select: { id: true } }) : Promise.resolve([]),
        accessible.has("finance") ? tx.financeObligation.findMany({ where: elsewhere, select: { id: true } }) : Promise.resolve([])
      ]);

      const meterDtos = await Promise.all(meters.map((meter) => this.meterDtoTx(tx, meter)));
      return {
        home: homeDto(home),
        taskIds: tasks.filter((t) => !isTaskClosed(t.status) || t.updatedAt >= since).map((t) => t.id),
        listIds: lists.map((l) => l.id),
        inventoryIds: items.map((i) => i.id),
        obligationIds: obligations.filter((o) => !o.closedAt).map((o) => o.id),
        elsewhere: {
          taskIds: otherTasks.map((t) => t.id),
          listIds: otherLists.map((l) => l.id),
          inventoryIds: otherItems.map((i) => i.id),
          obligationIds: otherBills.map((b) => b.id)
        },
        meters: meterDtos,
        contacts: contacts.map(contactDto)
      };
    });
  }

  // -------------------------------------------------------------- activity

  /**
   * What happened lately around this home, newest first: chore changes and comments, meter readings.
   * Chore entries appear only if the viewer may use the tasks module.
   */
  async activity(userId: string, workspaceId: string, homeId: string, limit = 30): Promise<ActivityEntry[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertHomeTx(tx, workspaceId, homeId);
      const accessible = await this.modules.accessibleSetTx(tx, userId, workspaceId);
      const entries: ActivityEntry[] = [];

      if (accessible.has("tasks")) {
        const [changes, comments] = await Promise.all([
          tx.taskActivity.findMany({
            where: { workspaceId, task: { homeId } },
            orderBy: { createdAt: "desc" },
            take: limit,
            include: { task: { select: { id: true, title: true } }, actor: { select: { name: true } } }
          }),
          tx.taskComment.findMany({
            where: { workspaceId, task: { homeId } },
            orderBy: { createdAt: "desc" },
            take: limit,
            include: { task: { select: { id: true, title: true } }, author: { select: { name: true } } }
          })
        ]);
        for (const row of changes) {
          const summary =
            row.field === "status"
              ? `Статус: ${STATUS_RU[row.fromValue ?? ""] ?? "—"} → ${STATUS_RU[row.toValue ?? ""] ?? "—"}`
              : row.field === "dueAt"
                ? "Срок изменён"
                : row.field === "assigneeId"
                  ? "Исполнитель изменён"
                  : `Изменено: ${row.field}`;
          entries.push({
            id: `task_change:${row.id}`,
            kind: "task_change",
            at: row.createdAt.toISOString(),
            actorKind: row.actor ? "user" : "unknown",
            actorName: row.actor?.name ?? "—",
            summary,
            entity: { type: "task", id: row.task.id, title: row.task.title }
          });
        }
        for (const row of comments) {
          entries.push({
            id: `task_comment:${row.id}`,
            kind: "task_comment",
            at: row.createdAt.toISOString(),
            actorKind: "user",
            actorName: row.author.name,
            summary: "Комментарий к делу",
            entity: { type: "task", id: row.task.id, title: row.task.title }
          });
        }
      }

      const readings = await tx.meterReading.findMany({
        where: { workspaceId, meter: { homeId } },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: { meter: { select: { name: true, unit: true } } }
      });
      for (const row of readings) {
        entries.push({
          id: `meter_reading:${row.id}`,
          kind: "meter_reading",
          at: row.createdAt.toISOString(),
          actorKind: "unknown",
          actorName: "",
          summary: `Счётчик «${row.meter.name}»: ${row.value}${row.meter.unit ? ` ${row.meter.unit}` : ""}`,
          entity: null
        });
      }
      return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
    });
  }

  // ---------------------------------------------------------- attach / detach

  async attach(userId: string, workspaceId: string, homeId: string, input: AttachToHomeInput): Promise<void> {
    await this.setHome(userId, workspaceId, input, homeId, homeId);
  }

  async detach(userId: string, workspaceId: string, homeId: string, input: AttachToHomeInput): Promise<void> {
    await this.setHome(userId, workspaceId, input, null, homeId);
  }

  private async setHome(userId: string, workspaceId: string, input: AttachToHomeInput, value: string | null, homeId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertHomeTx(tx, workspaceId, homeId);
      const moduleId = { task: "tasks", list: "lists", inventory: "inventory", obligation: "finance" }[input.type] as "tasks" | "lists" | "inventory" | "finance";
      await this.modules.assertEnabledTx(tx, userId, workspaceId, moduleId);
      // Detaching only touches rows that point at THIS home.
      const where = { id: input.id, workspaceId, ...(value === null ? { homeId } : {}) };
      const data = { homeId: value };
      const result =
        input.type === "task"
          ? await tx.task.updateMany({ where, data })
          : input.type === "list"
            ? await tx.list.updateMany({ where, data })
            : input.type === "inventory"
              ? await tx.inventoryItem.updateMany({ where, data })
              : await tx.financeObligation.updateMany({ where, data });
      if (result.count === 0) throw new NotFoundException("Запись не найдена");
    });
  }

  // ---------------------------------------------------------------- meters

  async createMeter(userId: string, workspaceId: string, homeId: string, input: CreateMeterInput): Promise<Meter> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertHomeTx(tx, workspaceId, homeId);
      const row = await tx.meter.create({
        data: { workspaceId, homeId, name: input.name, kind: input.kind, unit: input.unit ?? METER_KIND_UNIT[input.kind] }
      });
      return this.meterDtoTx(tx, row);
    });
  }

  async updateMeter(userId: string, workspaceId: string, homeId: string, meterId: string, input: UpdateMeterInput): Promise<Meter> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertMeterTx(tx, workspaceId, homeId, meterId);
      const row = await tx.meter.update({
        where: { id: meterId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.unit !== undefined ? { unit: input.unit } : {})
        }
      });
      return this.meterDtoTx(tx, row);
    });
  }

  async removeMeter(userId: string, workspaceId: string, homeId: string, meterId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertMeterTx(tx, workspaceId, homeId, meterId);
      await tx.meter.delete({ where: { id: meterId } });
    });
  }

  async addReading(
    userId: string,
    workspaceId: string,
    homeId: string,
    meterId: string,
    input: CreateMeterReadingInput
  ): Promise<Meter> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const meter = await this.assertMeterTx(tx, workspaceId, homeId, meterId);
      const readAt = input.readAt ? new Date(input.readAt) : new Date();
      const existing = await tx.meterReading.findMany({ where: { meterId }, select: { value: true, readAt: true } });
      const problem = readingProblem(
        existing.map((r) => ({ value: r.value, readAt: r.readAt.toISOString() })),
        { value: input.value, readAt: readAt.toISOString() }
      );
      if (problem) throw new BadRequestException(problem);
      await tx.meterReading.create({ data: { workspaceId, meterId, value: input.value, readAt, note: input.note } });
      return this.meterDtoTx(tx, meter);
    });
  }

  async removeReading(userId: string, workspaceId: string, homeId: string, meterId: string, readingId: string): Promise<Meter> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const meter = await this.assertMeterTx(tx, workspaceId, homeId, meterId);
      const result = await tx.meterReading.deleteMany({ where: { id: readingId, meterId, workspaceId } });
      if (result.count === 0) throw new NotFoundException("Показание не найдено");
      return this.meterDtoTx(tx, meter);
    });
  }

  // -------------------------------------------------------------- contacts

  async createContact(userId: string, workspaceId: string, homeId: string, input: CreateContactInput): Promise<Contact> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertHomeTx(tx, workspaceId, homeId);
      return tx.contact.create({ data: { workspaceId, homeId, name: input.name, role: input.role, phone: input.phone, note: input.note } });
    });
    return contactDto(row);
  }

  async updateContact(userId: string, workspaceId: string, homeId: string, contactId: string, input: UpdateContactInput): Promise<Contact> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertContactTx(tx, workspaceId, homeId, contactId);
      return tx.contact.update({
        where: { id: contactId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.note !== undefined ? { note: input.note } : {})
        }
      });
    });
    return contactDto(row);
  }

  async removeContact(userId: string, workspaceId: string, homeId: string, contactId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertContactTx(tx, workspaceId, homeId, contactId);
      await tx.contact.delete({ where: { id: contactId } });
    });
  }

  // --------------------------------------------------------------- helpers

  /** Compared in code: the database's ILIKE does not fold Cyrillic case on every locale. */
  private async assertNameFreeTx(tx: Prisma.TransactionClient, workspaceId: string, name: string, exceptId: string | null): Promise<void> {
    const wanted = name.trim().toLowerCase();
    const names = await tx.home.findMany({ where: { workspaceId, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { name: true } });
    if (names.some((h) => h.name.trim().toLowerCase() === wanted)) throw new ConflictException("Дом с таким названием уже есть");
  }

  private async assertHomeTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string): Promise<HomeRow> {
    const home = await tx.home.findUnique({ where: { id: homeId } });
    if (!home || home.workspaceId !== workspaceId) throw new NotFoundException("Дом не найден");
    return home;
  }

  private async assertMeterTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string, meterId: string): Promise<MeterRow> {
    const meter = await tx.meter.findUnique({ where: { id: meterId } });
    if (!meter || meter.workspaceId !== workspaceId || meter.homeId !== homeId) throw new NotFoundException("Счётчик не найден");
    return meter;
  }

  private async assertContactTx(tx: Prisma.TransactionClient, workspaceId: string, homeId: string, contactId: string): Promise<ContactRow> {
    const contact = await tx.contact.findUnique({ where: { id: contactId } });
    if (!contact || contact.workspaceId !== workspaceId || contact.homeId !== homeId) throw new NotFoundException("Контакт не найден");
    return contact;
  }

  private async meterDtoTx(tx: Prisma.TransactionClient, meter: MeterRow): Promise<Meter> {
    // One extra row so the oldest SHOWN reading still has a predecessor to compute usage against.
    const rows = await tx.meterReading.findMany({ where: { meterId: meter.id }, orderBy: { readAt: "desc" }, take: READINGS_SHOWN + 1 });
    return meterDto(meter, rows);
  }
}

function homeDto(row: HomeRow): Home {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    kind: homeKindSchema.catch("other").parse(row.kind),
    note: row.note,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function meterDto(meter: MeterRow, rows: ReadingRow[]): Meter {
  const withUsage = withConsumption(rows.map((r) => ({ id: r.id, value: r.value, readAt: r.readAt.toISOString(), note: r.note })));
  const shown = withUsage.slice(0, READINGS_SHOWN);
  return {
    id: meter.id,
    homeId: meter.homeId,
    name: meter.name,
    kind: meterKindSchema.catch("other").parse(meter.kind),
    unit: meter.unit,
    readings: shown,
    lastValue: shown[0]?.value ?? null,
    lastReadAt: shown[0]?.readAt ?? null
  };
}

function contactDto(row: ContactRow): Contact {
  return { id: row.id, homeId: row.homeId, name: row.name, role: row.role, phone: row.phone, note: row.note };
}
