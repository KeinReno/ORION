import { TaskHomeLinks } from "../tasks/public/task-home-links";
import { ListHomeLinks } from "../lists/public/list-home-links";
import { InventoryHomeLinks } from "../inventory/public/inventory-home-links";
import { ObligationHomeLinks } from "../finance/public/obligation-home-links";
import { TaskJournalReader } from "../tasks/public/task-journal-reader";
import { TaskTimeReader } from "../time/public/task-time-reader";
import { HomeContactCommands } from "../contacts/public/home-contact-commands";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Home as HomeRow, Meter as MeterRow, MeterReading as ReadingRow, Prisma } from "@prisma/client";
import {
  CONTRIBUTION_PERIOD_DAYS,
  METER_KIND_UNIT,
  buildContributions,
  entryMinutes,
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
  type ContributionPeriod,
  type ContributionTask,
  type Home,
  type HomeContributions,
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
    private readonly modules: ModulesService,
    private readonly taskLinks: TaskHomeLinks,
    private readonly listLinks: ListHomeLinks,
    private readonly inventoryLinks: InventoryHomeLinks,
    private readonly obligationLinks: ObligationHomeLinks,
    private readonly taskJournal: TaskJournalReader,
    private readonly taskTime: TaskTimeReader,
    private readonly contactCommands: HomeContactCommands
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

  /** Meters and readings go with the home; contacts, chores, lists, things and payments only lose the link. */
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
          ? this.taskLinks.atHomeTx(tx, workspaceId, homeId)
          : Promise.resolve([]),
        accessible.has("lists") ? this.listLinks.atHomeTx(tx, workspaceId, homeId) : Promise.resolve([]),
        accessible.has("inventory")
          ? this.inventoryLinks.atHomeTx(tx, workspaceId, homeId)
          : Promise.resolve([]),
        accessible.has("finance")
          ? this.obligationLinks.atHomeTx(tx, workspaceId, homeId)
          : Promise.resolve([]),
        tx.meter.findMany({ where: { workspaceId, homeId }, orderBy: { createdAt: "asc" } }),
        this.contactCommands.listTx(tx, workspaceId, homeId)
      ]);

      const [otherTasks, otherLists, otherItems, otherBills] = await Promise.all([
        accessible.has("tasks") ? this.taskLinks.elsewhereTx(tx, workspaceId, homeId) : Promise.resolve([]),
        accessible.has("lists") ? this.listLinks.elsewhereTx(tx, workspaceId, homeId) : Promise.resolve([]),
        accessible.has("inventory") ? this.inventoryLinks.elsewhereTx(tx, workspaceId, homeId) : Promise.resolve([]),
        accessible.has("finance") ? this.obligationLinks.elsewhereTx(tx, workspaceId, homeId) : Promise.resolve([])
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
        contacts
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
        const { changes, comments } = await this.taskJournal.recentTx(tx, workspaceId, limit, homeId);
        for (const row of changes) {
          const summary =
            row.field === "created"
              ? "Создана задача"
              : row.field === "status"
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
            actorKind: row.agentName ? "agent" : row.actor ? "user" : "unknown",
            actorName: row.agentName ?? row.actor?.name ?? "—",
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

  // ---------------------------------------------------------- contributions

  /**
   * Кто сколько закрыл дел дома за период (см. `buildContributions`). `homeId = null` — по делам всех
   * объектов. Исполнитель — автор последнего перехода в `done` из журнала TaskActivity; назначенный —
   * отдельно, поэтому «взял чужое» видно. Нужен доступ к модулю «Задачи».
   */
  async contributions(userId: string, workspaceId: string, period: ContributionPeriod, homeId: string | null): Promise<HomeContributions> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      if (homeId) await this.assertHomeTx(tx, workspaceId, homeId);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "tasks");
      const now = new Date();
      const windowStart = new Date(now.getTime() - CONTRIBUTION_PERIOD_DAYS[period] * 24 * 60 * 60 * 1000);

      const [memberRows, rows] = await Promise.all([
        tx.workspaceMember.findMany({ where: { workspaceId }, select: { id: true, userId: true, user: { select: { name: true } } } }),
        this.taskLinks.contributionTasksTx(tx, workspaceId, homeId, windowStart)
      ]);

      const doneIds = rows.filter((t) => t.status === "done").map((t) => t.id);
      const closers = doneIds.length
        ? await this.taskLinks.closersTx(tx, workspaceId, doneIds)
        : [];
      // Последний переход в done выигрывает: дело могли переоткрыть и закрыть другим человеком.
      const closerByTask = new Map(closers.map((c) => [c.taskId, c.actorId]));
      const userByMember = new Map(memberRows.map((m) => [m.id, m.userId]));

      const timeEntries = await this.taskTime.entriesTx(tx, workspaceId, rows.map(row => row.id));
      const trackedByTask = new Map<string, number>();
      for (const e of timeEntries) if (e.taskId) {
        const minutes = entryMinutes({ startedAt: e.startedAt.toISOString(), endedAt: e.endedAt?.toISOString() ?? null }, now);
        trackedByTask.set(e.taskId, (trackedByTask.get(e.taskId) ?? 0) + minutes);
      }
      const tasks: ContributionTask[] = rows.map((t) => {
        const tracked = trackedByTask.get(t.id) ?? 0;
        return {
          status: t.status,
          completedAt: t.completedAt?.toISOString() ?? null,
          dueAt: t.dueAt?.toISOString() ?? null,
          assigneeUserId: t.assigneeId ? userByMember.get(t.assigneeId) ?? null : null,
          closerUserId: closerByTask.get(t.id) ?? null,
          minutes: tracked > 0 ? tracked : t.estimatedMinutes
        };
      });
      return buildContributions({ period, now, members: memberRows.map((m) => ({ userId: m.userId, name: m.user.name })), tasks });
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
      const requiredHomeId = value === null ? homeId : undefined;
      const count = input.type === "task"
        ? await this.taskLinks.setHomeTx(tx, workspaceId, input.id, value, requiredHomeId)
        : input.type === "list"
          ? await this.listLinks.setHomeTx(tx, workspaceId, input.id, value, requiredHomeId)
          : input.type === "inventory"
            ? await this.inventoryLinks.setHomeTx(tx, workspaceId, input.id, value, requiredHomeId)
            : await this.obligationLinks.setHomeTx(tx, workspaceId, input.id, value, requiredHomeId);
      if (count === 0) throw new NotFoundException("Запись не найдена");
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
      return this.contactCommands.createTx(tx, workspaceId, homeId, input);
    });
    return row;
  }

  async updateContact(userId: string, workspaceId: string, homeId: string, contactId: string, input: UpdateContactInput): Promise<Contact> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return this.contactCommands.updateTx(tx, workspaceId, homeId, contactId, input);
    });
    return row;
  }

  async removeContact(userId: string, workspaceId: string, homeId: string, contactId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.contactCommands.removeTx(tx, workspaceId, homeId, contactId);
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

