import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  compareProjectsByLifecycle,
  entryMinutes,
  normaliseProjectOrder,
  type ReorderProjectsInput,
  projectTaskRollup,
  projectTimeRollup,
  type CreateProjectInput,
  type OrionModuleId,
  type Project,
  type ProjectActivity,
  type ProjectDetail,
  type UpdateProjectInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService
  ) {}

  async list(userId: string, workspaceId: string, archived = false): Promise<Project[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const rows = await tx.project.findMany({
        where: { workspaceId, archivedAt: archived ? { not: null } : null }
      });
      rows.sort(compareProjectsByLifecycle);
      return this.toDtos(tx, userId, rows);
    });
  }

  /**
   * Writes the team-shared order in ONE statement (all-or-nothing). Owner/lead only. Ids of other
   * workspaces are rejected (400); ids that no longer exist anywhere are stale and ignored.
   */
  async reorder(userId: string, workspaceId: string, input: ReorderProjectsInput): Promise<{ updated: number }> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
      const found = await tx.project.findMany({ where: { id: { in: input.ids } }, select: { id: true, workspaceId: true } });
      const own = new Set(found.filter((p) => p.workspaceId === workspaceId).map((p) => p.id));
      const elsewhere = new Set(found.filter((p) => p.workspaceId !== workspaceId).map((p) => p.id));
      const { ids, foreign } = normaliseProjectOrder(input.ids, own, elsewhere);
      if (foreign.length > 0) throw new BadRequestException("Проект принадлежит другому пространству");
      if (ids.length === 0) return { updated: 0 };
      const orders = ids.map((_, index) => index);
      const updated = await tx.$executeRaw`
        UPDATE "projects" AS p SET "sharedOrder" = v.ord
        FROM unnest(${ids}::text[], ${orders}::int[]) AS v(id, ord)
        WHERE p."id" = v.id AND p."workspaceId" = ${workspaceId}`;
      return { updated };
    });
  }

  async get(userId: string, workspaceId: string, projectId: string): Promise<ProjectDetail> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const row = await this.assertOwnedTx(tx, workspaceId, projectId);
      const [items, activity] = await Promise.all([
        this.toDtos(tx, userId, [row]),
        this.activity(tx, projectId, await this.modules.accessibleSetTx(tx, userId, workspaceId))
      ]);
      const project = items[0];
      if (!project) throw new NotFoundException("Проект не найден");
      return { ...project, activity };
    });
  }

  async create(userId: string, workspaceId: string, input: CreateProjectInput): Promise<Project> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const duplicate = await tx.project.findFirst({
        where: { workspaceId, name: { equals: input.name, mode: "insensitive" } }
      });
      if (duplicate) throw new ConflictException("Проект с таким названием уже существует");
      const row = await tx.project.create({
        data: {
          workspaceId,
          ...input,
          startAt: input.startAt ?? null,
          dueAt: input.dueAt ?? null,
          budgetAmount: input.budgetAmount ?? null,
          hourlyRate: input.hourlyRate ?? null,
          color: input.color ?? null
        }
      });
      return this.requireDto(await this.toDtos(tx, userId, [row]));
    });
  }

  async update(userId: string, workspaceId: string, projectId: string, input: UpdateProjectInput): Promise<Project> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, projectId);
      if (input.name) {
        const duplicate = await tx.project.findFirst({
          where: { workspaceId, id: { not: projectId }, name: { equals: input.name, mode: "insensitive" } }
        });
        if (duplicate) throw new ConflictException("Проект с таким названием уже существует");
      }
      const row = await tx.project.update({ where: { id: projectId }, data: input });
      return this.requireDto(await this.toDtos(tx, userId, [row]));
    });
  }

  async archive(userId: string, workspaceId: string, projectId: string): Promise<Project> {
    return this.update(userId, workspaceId, projectId, { archivedAt: new Date().toISOString() });
  }

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string) {
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project || project.workspaceId !== workspaceId) throw new NotFoundException("Проект не найден");
    return project;
  }

  private requireDto(items: Project[]): Project {
    const project = items[0];
    if (!project) throw new NotFoundException("Проект не найден");
    return project;
  }

  /**
   * One round of contribution queries for every project in `rows`. Disabled
   * neighbour modules are skipped entirely — the DTO still carries zeros so
   * the contract stays stable, and the UI hides those blocks.
   */
  private async toDtos(
    tx: Prisma.TransactionClient,
    userId: string,
    rows: Prisma.ProjectGetPayload<Record<string, never>>[]
  ): Promise<Project[]> {
    if (rows.length === 0) return [];
    const workspaceId = rows[0]?.workspaceId;
    if (!workspaceId) return [];
    const ids = rows.map((row) => row.id);
    const enabled = await this.modules.accessibleSetTx(tx, userId, workspaceId);
    const now = new Date();

    const [
      taskGroups,
      noteGroups,
      eventGroups,
      documentGroups,
      inventoryGroups,
      expenseLines,
      timeRows,
      estimatedTaskGroups,
      activityMaxes,
      latestReports
    ] = await Promise.all([
        enabled.has("tasks")
          ? tx.task.groupBy({ by: ["projectId", "status"], where: { projectId: { in: ids } }, _count: true })
          : [],
        enabled.has("notes")
          ? tx.note.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, deletedAt: null }, _count: true })
          : [],
        enabled.has("calendar")
          ? tx.event.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _count: true })
          : [],
        enabled.has("documents")
          ? tx.document.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, deletedAt: null }, _count: true })
          : [],
        enabled.has("inventory")
          ? tx.inventoryItem.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, archivedAt: null }, _count: true })
          : [],
        enabled.has("finance")
          ? tx.transactionLine.findMany({
              where: { transaction: { projectId: { in: ids }, type: "expense" } },
              // An expense's currency is its source account's (as in budgetSpentTx).
              select: { amount: true, transaction: { select: { projectId: true, account: { select: { currency: true } } } } }
            })
          : [],
        enabled.has("time")
          ? tx.timeEntry.findMany({
              where: { projectId: { in: ids } },
              select: { projectId: true, startedAt: true, endedAt: true }
            })
          : [],
        // `where: estimatedMinutes: { not: null }` doubles as the "has any
        // estimate at all" signal via `_count` — a project with zero rows
        // here is "not estimated" (null on the DTO), not "estimated at 0".
        enabled.has("tasks")
          ? tx.task.groupBy({
              by: ["projectId"],
              where: { projectId: { in: ids }, estimatedMinutes: { not: null } },
              _sum: { estimatedMinutes: true },
              _count: true
            })
          : [],
        // "Открывали N дней назад" (lastActivityAt) — newest touch across
        // every enabled neighbour module, computed once here rather than
        // separately in list() and get(), so the two never disagree.
        this.activityMaxByProjectTx(tx, ids, enabled),
        // Newest manual status report per project (UI-05). It belongs to the
        // projects module itself, so it is not gated by a neighbour module.
        tx.projectStatusUpdate.findMany({
          where: { projectId: { in: ids } },
          orderBy: [{ projectId: "asc" }, { createdAt: "desc" }, { id: "desc" }],
          distinct: ["projectId"],
          select: { projectId: true, health: true, createdAt: true }
        })
      ]);
    const reportByProject = new Map(latestReports.map((report) => [report.projectId, report]));

    const tasksByProject = new Map<string, Array<{ status: string; count: number }>>();
    for (const entry of taskGroups) {
      if (!entry.projectId) continue;
      const list = tasksByProject.get(entry.projectId) ?? [];
      list.push({ status: entry.status, count: entry._count });
      tasksByProject.set(entry.projectId, list);
    }
    const notesByProject = countMap(noteGroups);
    const eventsByProject = countMap(eventGroups);
    const documentsByProject = countMap(documentGroups);
    const inventoryByProject = countMap(inventoryGroups);
    // Kopecks of different currencies are never added together: per project,
    // `spentAmount` counts only the project's own currency, the rest is
    // reported per currency in `spentOther`.
    const projectCurrency = new Map(rows.map((row) => [row.id, row.currency]));
    const spentByProject = new Map<string, number>();
    const spentOtherByProject = new Map<string, Map<string, number>>();
    for (const line of expenseLines) {
      const projectId = line.transaction.projectId;
      if (!projectId) continue;
      const currency = line.transaction.account.currency;
      if (currency === projectCurrency.get(projectId)) {
        spentByProject.set(projectId, (spentByProject.get(projectId) ?? 0) + line.amount);
      } else {
        const other = spentOtherByProject.get(projectId) ?? new Map<string, number>();
        other.set(currency, (other.get(currency) ?? 0) + line.amount);
        spentOtherByProject.set(projectId, other);
      }
    }
    const minutesByProject = new Map<string, number>();
    for (const entry of timeRows) {
      if (!entry.projectId) continue;
      minutesByProject.set(
        entry.projectId,
        (minutesByProject.get(entry.projectId) ?? 0) +
          entryMinutes(
            { startedAt: entry.startedAt.toISOString(), endedAt: entry.endedAt?.toISOString() ?? null },
            now
          )
      );
    }

    const plannedByProject = new Map<string, number>();
    for (const entry of estimatedTaskGroups) {
      if (!entry.projectId) continue;
      plannedByProject.set(entry.projectId, entry._sum.estimatedMinutes ?? 0);
    }

    return rows.map((row) => {
      const tasksRollup = projectTaskRollup(tasksByProject.get(row.id) ?? []);
      const time = projectTimeRollup(minutesByProject.get(row.id) ?? 0, row.hourlyRate);
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        name: row.name,
        description: row.description,
        status: row.status as Project["status"],
        color: row.color,
        startAt: row.startAt?.toISOString() ?? null,
        dueAt: row.dueAt?.toISOString() ?? null,
        budgetAmount: row.budgetAmount,
        hourlyRate: row.hourlyRate,
        currency: row.currency,
        contextNote: row.contextNote,
        sharedOrder: row.sharedOrder,
        reportedHealth: (reportByProject.get(row.id)?.health as Project["reportedHealth"]) ?? null,
        reportedAt: reportByProject.get(row.id)?.createdAt.toISOString() ?? null,
        archivedAt: row.archivedAt?.toISOString() ?? null,
        progress: tasksRollup.progress,
        counts: {
          tasks: tasksRollup.taskCount,
          closed: tasksRollup.closedCount,
          notes: notesByProject.get(row.id) ?? 0,
          events: eventsByProject.get(row.id) ?? 0,
          documents: documentsByProject.get(row.id) ?? 0,
          inventory: inventoryByProject.get(row.id) ?? 0
        },
        spentAmount: spentByProject.get(row.id) ?? 0,
        spentOther: [...(spentOtherByProject.get(row.id) ?? [])]
          .filter(([, amount]) => amount > 0)
          .map(([currency, amount]) => ({ currency, amount }))
          .sort((a, b) => a.currency.localeCompare(b.currency)),
        trackedMinutes: time.trackedMinutes,
        timeCost: time.timeCost,
        unratedMinutes: time.unratedMinutes,
        plannedMinutes: plannedByProject.has(row.id) ? (plannedByProject.get(row.id) ?? 0) : null,
        lastActivityAt: activityMaxes.get(row.id)?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      };
    });
  }

  /**
   * Newest `updatedAt` per project across every enabled neighbour module
   * (tasks/notes/events/documents/finance) — a lightweight `_max` groupBy per
   * table rather than one raw UNION query, so a disabled module is simply
   * left out instead of needing a dynamic SQL branch.
   */
  private async activityMaxByProjectTx(
    tx: Prisma.TransactionClient,
    ids: string[],
    enabled: Set<OrionModuleId>
  ): Promise<Map<string, Date>> {
    const [tasks, notes, events, documents, inventory, transactions] = await Promise.all([
      enabled.has("tasks")
        ? tx.task.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _max: { updatedAt: true } })
        : [],
      enabled.has("notes")
        ? tx.note.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, deletedAt: null }, _max: { updatedAt: true } })
        : [],
      enabled.has("calendar")
        ? tx.event.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _max: { updatedAt: true } })
        : [],
      enabled.has("documents")
        ? tx.document.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, deletedAt: null }, _max: { updatedAt: true } })
        : [],
      enabled.has("inventory")
        ? tx.inventoryItem.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _max: { updatedAt: true } })
        : [],
      enabled.has("finance")
        ? tx.transaction.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _max: { updatedAt: true } })
        : []
    ]);
    const max = new Map<string, Date>();
    const fold = (groups: Array<{ projectId: string | null; _max: { updatedAt: Date | null } }>): void => {
      for (const entry of groups) {
        if (!entry.projectId || !entry._max.updatedAt) continue;
        const current = max.get(entry.projectId);
        if (!current || entry._max.updatedAt > current) max.set(entry.projectId, entry._max.updatedAt);
      }
    };
    fold(tasks);
    fold(notes);
    fold(events);
    fold(documents);
    fold(inventory);
    fold(transactions);
    return max;
  }

  private async activity(
    tx: Prisma.TransactionClient,
    projectId: string,
    enabled: Set<OrionModuleId>
  ): Promise<ProjectActivity[]> {
    const [tasks, notes, events, documents, transactions, inventory, milestones] = await Promise.all([
      enabled.has("tasks")
        ? tx.task.findMany({
            where: { projectId },
            select: { id: true, title: true, status: true, updatedAt: true },
            take: 20,
            orderBy: { updatedAt: "desc" }
          })
        : [],
      enabled.has("notes")
        ? tx.note.findMany({
            where: { projectId, deletedAt: null },
            select: { id: true, title: true, updatedAt: true },
            take: 20,
            orderBy: { updatedAt: "desc" }
          })
        : [],
      enabled.has("calendar")
        ? tx.event.findMany({
            where: { projectId },
            select: { id: true, title: true, updatedAt: true },
            take: 20,
            orderBy: { updatedAt: "desc" }
          })
        : [],
      enabled.has("documents")
        ? tx.document.findMany({
            where: { projectId, deletedAt: null },
            select: { id: true, name: true, updatedAt: true },
            take: 20,
            orderBy: { updatedAt: "desc" }
          })
        : [],
      enabled.has("finance")
        ? tx.transaction.findMany({
            where: { projectId },
            select: { id: true, note: true, type: true, updatedAt: true },
            take: 20,
            orderBy: { updatedAt: "desc" }
          })
        : [],
      enabled.has("inventory")
        ? tx.inventoryItem.findMany({
            where: { projectId, archivedAt: null },
            select: { id: true, name: true, updatedAt: true },
            take: 20,
            orderBy: { updatedAt: "desc" }
          })
        : [],
      // Milestones live in the "projects" module itself, so no enabled-check.
      tx.milestone.findMany({
        where: { projectId },
        select: { id: true, title: true, status: true, updatedAt: true },
        take: 20,
        orderBy: { updatedAt: "desc" }
      })
    ]);
    return [
      ...tasks.map((item) => ({
        id: item.id,
        type: "task" as const,
        title: item.title,
        at: item.updatedAt.toISOString(),
        status: item.status
      })),
      ...notes.map((item) => ({
        id: item.id,
        type: "note" as const,
        title: item.title,
        at: item.updatedAt.toISOString(),
        status: null
      })),
      ...events.map((item) => ({
        id: item.id,
        type: "event" as const,
        title: item.title,
        at: item.updatedAt.toISOString(),
        status: null
      })),
      ...documents.map((item) => ({
        id: item.id,
        type: "document" as const,
        title: item.name,
        at: item.updatedAt.toISOString(),
        status: null
      })),
      ...transactions.map((item) => ({
        id: item.id,
        type: "transaction" as const,
        title: item.note || "Финансовая операция",
        at: item.updatedAt.toISOString(),
        status: item.type
      })),
      ...inventory.map((item) => ({
        id: item.id,
        type: "inventory" as const,
        title: item.name,
        at: item.updatedAt.toISOString(),
        status: null
      })),
      ...milestones.map((item) => ({
        id: item.id,
        type: "milestone" as const,
        title: item.title,
        at: item.updatedAt.toISOString(),
        status: item.status
      }))
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 30);
  }
}

function countMap(groups: Array<{ projectId: string | null; _count: number }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of groups) {
    if (!entry.projectId) continue;
    map.set(entry.projectId, entry._count);
  }
  return map;
}
