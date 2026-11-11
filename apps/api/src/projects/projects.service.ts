import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  PROJECT_TREE_MAX_DEPTH,
  compareProjectsByLifecycle,
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
import { ProjectAggregateRegistry, type ProjectAggregate } from "../common/project-aggregates";
import { PrismaService } from "../common/prisma.service";
import { DomainEventBus } from "../domain-events/domain-event-bus";
import { ModulesService } from "../modules/modules.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ProjectHierarchyRepository } from "./project-hierarchy.repository";
import { ProjectHistoryService } from "./project-history.service";

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService,
    private readonly aggregates: ProjectAggregateRegistry,
    private readonly events: DomainEventBus,
    private readonly hierarchy: ProjectHierarchyRepository,
    private readonly history: ProjectHistoryService
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
      const [items, activity, ancestors, childCount] = await Promise.all([
        this.toDtos(tx, userId, [row]),
        this.activity(tx, projectId, await this.modules.accessibleSetTx(tx, userId, workspaceId)),
        // Дерево проектов (задание 03): путь от корня до родителя + число детей.
        this.hierarchy.ancestorsTx(tx, workspaceId, projectId),
        tx.project.count({ where: { workspaceId, parentId: projectId, archivedAt: null } })
      ]);
      const project = items[0];
      if (!project) throw new NotFoundException("Проект не найден");
      return { ...project, activity, ancestors, childCount };
    });
  }

  async create(userId: string, workspaceId: string, input: CreateProjectInput): Promise<Project> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const duplicate = await tx.project.findFirst({
        where: { workspaceId, name: { equals: input.name, mode: "insensitive" } }
      });
      if (duplicate) throw new ConflictException("Проект с таким названием уже существует");
      // Новый проект сразу может быть дочерним — проверки те же, что при смене родителя.
      if (input.parentId) await this.assertParentAssignmentTx(tx, workspaceId, null, input.parentId);
      const row = await tx.project.create({
        data: {
          workspaceId,
          ...input,
          parentId: input.parentId ?? null,
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
      const current = await this.assertOwnedTx(tx, workspaceId, projectId);
      // 12.4: `expectedRevision` — CAS-токен в стиле Task.revision/Note.revision. Правка без него
      // (архивация, перестановка полей из соседних сценариев) остаётся last-write-wins, но ревизия
      // всё равно растёт, чтобы открытая форма узнала о чужой записи.
      const { expectedRevision, ...patch } = input;
      if (input.name) {
        const duplicate = await tx.project.findFirst({
          where: { workspaceId, id: { not: projectId }, name: { equals: input.name, mode: "insensitive" } }
        });
        if (duplicate) throw new ConflictException("Проект с таким названием уже существует");
      }
      // Дерево (задание 03): проверка цикла и глубины ДО записи; блокировка пространства
      // внутри — чтобы две встречные правки не создали петлю.
      if (input.parentId !== undefined) await this.assertParentAssignmentTx(tx, workspaceId, projectId, input.parentId);
      const written = await tx.project.updateMany({
        where: { id: projectId, ...(expectedRevision !== undefined ? { revision: expectedRevision } : {}) },
        data: { ...patch, revision: { increment: 1 } }
      });
      if (written.count === 0) {
        const latest = await this.assertOwnedTx(tx, workspaceId, projectId);
        throw new ConflictException({
          code: "project_revision_conflict",
          message: "Проект изменил кто-то другой, пока вы редактировали — загрузите последнюю версию",
          currentRevision: latest.revision,
          current: this.requireDto(await this.toDtos(tx, userId, [latest]))
        });
      }
      const row = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
      // Audit trail (3.4) пишется в этой же транзакции: кто/когда/какое поле. Даты
      // нормализуются в Date, чтобы «тот же момент в другом поясе» не стал изменением.
      await this.history.recordTx(tx, {
        workspaceId,
        projectId,
        actorId: userId,
        changes: this.history.changesBetween(current, {
          ...patch,
          startAt: input.startAt !== undefined ? (input.startAt ? new Date(input.startAt) : null) : undefined,
          dueAt: input.dueAt !== undefined ? (input.dueAt ? new Date(input.dueAt) : null) : undefined,
          archivedAt: input.archivedAt !== undefined ? (input.archivedAt ? new Date(input.archivedAt) : null) : undefined
        })
      });
      // Задание 05: журнал проекта получает автозапись из события, а не из
      // прямого вызова logbook. Событие пишется в этой же транзакции (outbox).
      if (input.status !== undefined && input.status !== current.status) {
        await this.events.publishTx(tx, {
          workspaceId, actorId: userId, type: "projects.project.status_changed",
          payload: { id: projectId, from: current.status, to: input.status }
        });
      }
      if (input.startAt !== undefined || input.dueAt !== undefined) {
        const nextStart = input.startAt !== undefined ? input.startAt : current.startAt?.toISOString() ?? null;
        const prevStart = current.startAt?.toISOString() ?? null;
        const nextDue = input.dueAt !== undefined ? input.dueAt : current.dueAt?.toISOString() ?? null;
        const prevDue = current.dueAt?.toISOString() ?? null;
        if (nextStart !== prevStart || nextDue !== prevDue) {
          await this.events.publishTx(tx, {
            workspaceId, actorId: userId, type: "projects.project.dates_changed",
            payload: { id: projectId, startAtFrom: prevStart, startAtTo: nextStart, dueAtFrom: prevDue, dueAtTo: nextDue }
          });
        }
      }
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

  /**
   * Иерархия проектов (3.1): родитель должен быть в этом же пространстве, не создавать
   * цикл и не выводить дерево за пределы `PROJECT_TREE_MAX_DEPTH`. Цикл — 409 с путём
   * `A → B → C → A`; слишком глубокое дерево — 400 с понятной причиной.
   *
   * Блокировка строки пространства сериализует правки дерева: без неё две встречные
   * правки (A.parent=B и B.parent=A) прошли бы проверку обе и создали петлю.
   */
  private async assertParentAssignmentTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    projectId: string | null,
    parentId: string | null
  ): Promise<void> {
    if (!parentId) return;
    if (projectId && parentId === projectId) {
      throw new ConflictException({ code: "project_hierarchy_cycle", message: `Цикл иерархии проектов: ${parentId} → ${projectId}` });
    }
    await this.hierarchy.lockWorkspaceTx(tx, workspaceId);
    // Цепочка [родитель, …, корень]. Проект не найден → 404, а не «создадим корень».
    const chain = await this.hierarchy.chainTx(tx, workspaceId, parentId);
    if (chain.length === 0) throw new NotFoundException("Родительский проект не найден");
    if (projectId) {
      const index = chain.findIndex((node) => node.id === projectId);
      if (index >= 0) {
        // Проект — предок назначаемого родителя. Путь цикла: A → … → родитель → A.
        const path = chain.slice(0, index + 1).reverse();
        const names = [...path.map((node) => node.name), path[0]?.name ?? projectId];
        throw new ConflictException({ code: "project_hierarchy_cycle", message: `Цикл иерархии проектов: ${names.join(" → ")}` });
      }
    }
    const subtreeDepth = projectId ? await this.hierarchy.subtreeDepthTx(tx, workspaceId, projectId) : 0;
    const newDepth = chain.length + 1;
    if (newDepth + subtreeDepth > PROJECT_TREE_MAX_DEPTH) {
      throw new BadRequestException(
        `Дерево проектов не может быть глубже ${PROJECT_TREE_MAX_DEPTH} уровней: проект оказался бы на уровне ${newDepth}` +
          (subtreeDepth > 0 ? `, а его поддерево добавляет ещё ${subtreeDepth}` : "")
      );
    }
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

    // Соседние модули сообщают свои агрегаты через провайдеров (common/project-aggregates.ts): projects не читает
    // их таблицы. Выключенный модуль пропускается целиком — DTO по-прежнему несёт нули, UI прячет блок.
    const [contributions, latestReports] = await Promise.all([
      Promise.all(
        this.aggregates
          .providers()
          .filter((provider) => provider.aggregate && (provider.moduleId === null || enabled.has(provider.moduleId)))
          .map(async (provider) => [provider.id, await provider.aggregate!(tx, ids, now)] as const)
      ).then((entries) => new Map(entries)),
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
    const projectCurrency = new Map(rows.map((row) => [row.id, row.currency]));

    return rows.map((row) => {
      const part = (providerId: string): ProjectAggregate => contributions.get(providerId)?.get(row.id) ?? {};
      const tasks = part("tasks");
      const tasksRollup = projectTaskRollup(tasks.taskStatusCounts ?? []);
      const time = projectTimeRollup(part("time").trackedMinutes ?? 0, row.hourlyRate);
      // Kopecks of different currencies are never added together: `spentAmount`
      // counts only the project's own currency, the rest is reported per
      // currency in `spentOther`.
      const spent = part("finance").spent ?? [];
      const spentAmount = spent.find((item) => item.currency === projectCurrency.get(row.id))?.amount ?? 0;
      // "Открывали N дней назад" (lastActivityAt) — самое свежее касание среди всех включённых соседей; считается
      // один раз здесь, а не отдельно в list() и get(), чтобы они не расходились.
      let lastActivityAt: Date | null = null;
      for (const byProject of contributions.values()) {
        const at = byProject.get(row.id)?.lastActivityAt;
        if (at && (!lastActivityAt || at > lastActivityAt)) lastActivityAt = at;
      }
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
        parentId: row.parentId,
        reportedHealth: (reportByProject.get(row.id)?.health as Project["reportedHealth"]) ?? null,
        reportedAt: reportByProject.get(row.id)?.createdAt.toISOString() ?? null,
        archivedAt: row.archivedAt?.toISOString() ?? null,
        progress: tasksRollup.progress,
        counts: {
          tasks: tasksRollup.taskCount,
          closed: tasksRollup.closedCount,
          notes: part("notes").count ?? 0,
          events: part("events").count ?? 0,
          documents: part("documents").count ?? 0,
          inventory: part("inventory").count ?? 0
        },
        spentAmount,
        spentOther: spent
          .filter((item) => item.currency !== projectCurrency.get(row.id) && item.amount > 0)
          .sort((a, b) => a.currency.localeCompare(b.currency)),
        trackedMinutes: time.trackedMinutes,
        timeCost: time.timeCost,
        unratedMinutes: time.unratedMinutes,
        plannedMinutes: tasks.plannedMinutes ?? null,
        lastActivityAt: lastActivityAt?.toISOString() ?? null,
        revision: row.revision,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      };
    });
  }

  /**
   * Лента активности проекта: каждый включённый модуль-владелец отдаёт свои последние объекты через провайдера,
   * здесь они только сливаются и обрезаются до 30.
   */
  private async activity(tx: Prisma.TransactionClient, projectId: string, enabled: Set<OrionModuleId>): Promise<ProjectActivity[]> {
    const parts = await Promise.all(
      this.aggregates
        .providers()
        .filter((provider) => provider.recentActivity && (provider.moduleId === null || enabled.has(provider.moduleId)))
        .map((provider) => provider.recentActivity!(tx, projectId))
    );
    return parts
      .flat()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 30);
  }
}
