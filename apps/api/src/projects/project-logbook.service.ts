import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateProjectLogEntryInput,
  CreateProjectRelationInput,
  ProjectLogEntry,
  ProjectLogFilters,
  ProjectLogRelated,
  ProjectLogSummary,
  ProjectLogType,
  ProjectRelation,
  UpdateProjectLogEntryInput
} from "@orion/shared-types";
import { PROJECT_LOG_TYPES } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { EntityLinkOperations } from "../entity-links/public/entity-link-operations";
import { MentionsService } from "../notifications/mentions.service";
import { SearchOperations } from "../search/public/search-operations";
import { TaskReferenceReader } from "../tasks/public/task-reference-reader";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { normaliseProjectLogFields, readProjectLogAlternatives, validateProjectLogFields, type NormalisedProjectLogFields } from "./project-logbook-validation";

const ENTRY_LIMIT = 200;
const SUMMARY_ITEMS = 50;
const RELATED_LIMIT = 200;
type Tx = Parameters<Parameters<PrismaService["withUser"]>[1]>[0];

const entryInclude = {
  author: { select: { id: true, name: true } },
  tasks: true
} satisfies Prisma.ProjectLogEntryInclude;
type EntryModel = Prisma.ProjectLogEntryGetPayload<{ include: typeof entryInclude }>;

export type ProjectLogQuery = ProjectLogFilters;

interface AutoEntryInput {
  workspaceId: string;
  projectId: string;
  text: string;
  sourceEventId: string;
  sourceEventType: string;
  actorId: string | null;
  bulkId?: string;
}

@Injectable()
export class ProjectLogbookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly taskReferences: TaskReferenceReader,
    private readonly search: SearchOperations,
    private readonly entityLinks: EntityLinkOperations,
    private readonly mentions: MentionsService
  ) {}

  // ------------------------------------------------------------------ read

  async listEntries(userId: string, workspaceId: string, projectId: string, filters: ProjectLogQuery = {}): Promise<ProjectLogEntry[]> {
    return this.prisma.withUser(userId, async (tx) => {
      const membership = await this.membershipTx(tx, userId, workspaceId);
      await this.assertProject(tx, workspaceId, projectId);
      const ids = await this.projectScopeTx(tx, workspaceId, [projectId], filters.includeChildren !== "false");
      return this.listTx(tx, userId, workspaceId, ids, filters, isManager(membership.role));
    });
  }

  /** Список по всему пространству — фильтр `projectId` (с дочерними) живёт здесь. */
  async listWorkspaceEntries(userId: string, workspaceId: string, filters: ProjectLogQuery = {}): Promise<ProjectLogEntry[]> {
    return this.prisma.withUser(userId, async (tx) => {
      const membership = await this.membershipTx(tx, userId, workspaceId);
      let ids: string[] | null = null;
      if (filters.projectId) {
        await this.assertProject(tx, workspaceId, filters.projectId);
        ids = await this.projectScopeTx(tx, workspaceId, [filters.projectId], filters.includeChildren !== "false");
      }
      return this.listTx(tx, userId, workspaceId, ids, filters, isManager(membership.role));
    });
  }

  async summary(userId: string, workspaceId: string, projectId: string, filters: ProjectLogQuery = {}): Promise<ProjectLogSummary> {
    return this.prisma.withUser(userId, async (tx) => {
      const membership = await this.membershipTx(tx, userId, workspaceId);
      await this.assertProject(tx, workspaceId, projectId);
      const ids = await this.projectScopeTx(tx, workspaceId, [projectId], filters.includeChildren !== "false");
      const manager = isManager(membership.role);
      const where = this.whereTx(workspaceId, ids, filters);
      const now = new Date();

      const grouped = await tx.projectLogEntry.groupBy({ by: ["type"], where, _count: { _all: true } });
      const counts = Object.fromEntries(PROJECT_LOG_TYPES.map((type) => [type, 0])) as Record<ProjectLogType, number>;
      for (const row of grouped) counts[row.type] = row._count._all;

      const [overdue, incidents, decisions] = await Promise.all([
        tx.projectLogEntry.findMany({
          where: { ...where, type: "hypothesis", verificationDue: { not: null, lt: now } },
          include: entryInclude,
          orderBy: [{ verificationDue: "asc" }, { createdAt: "desc" }],
          take: SUMMARY_ITEMS
        }),
        tx.projectLogEntry.findMany({
          where: { ...where, type: "incident", resolution: "" },
          include: entryInclude,
          orderBy: [{ createdAt: "desc" }],
          take: SUMMARY_ITEMS
        }),
        tx.projectLogEntry.findMany({
          where: { ...where, type: "decision", confirmedBy: { none: {} } },
          include: entryInclude,
          orderBy: [{ createdAt: "desc" }],
          take: SUMMARY_ITEMS
        })
      ]);

      const dto = (rows: EntryModel[]) => this.toDtos(tx, rows, userId, manager);
      const [overdueHypotheses, incidentsWithoutResolution, decisionsWithoutResults] = await Promise.all([dto(overdue), dto(incidents), dto(decisions)]);
      return {
        projectId,
        from: filters.from ?? null,
        to: filters.to ?? null,
        counts,
        total: Object.values(counts).reduce((sum, value) => sum + value, 0),
        overdueHypotheses,
        incidentsWithoutResolution,
        decisionsWithoutResults
      };
    });
  }

  async related(userId: string, workspaceId: string, entryId: string): Promise<ProjectLogRelated> {
    const entry = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const row = await tx.projectLogEntry.findUnique({ where: { id: entryId }, select: { id: true, workspaceId: true } });
      if (!row || row.workspaceId !== workspaceId) throw new NotFoundException("Запись журнала не найдена");
      return row;
    });
    // Универсальный слой связей, без копирования материалов в самой записи.
    const links: ProjectLogRelated["links"] = [];
    let cursor: string | undefined;
    do {
      const page = await this.search.listLinks(userId, workspaceId, "project_log_entry", entry.id, { cursor, limit: 100 });
      links.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor && links.length < RELATED_LIMIT);
    return { entryId: entry.id, links: links.slice(0, RELATED_LIMIT) };
  }

  // ----------------------------------------------------------------- write

  async createEntry(userId: string, workspaceId: string, projectId: string, input: CreateProjectLogEntryInput): Promise<ProjectLogEntry> {
    const { entry, projectName } = await this.prisma.withUser(userId, async (tx) => {
      const membership = await this.membershipTx(tx, userId, workspaceId);
      await this.assertProject(tx, workspaceId, projectId);
      const project = await tx.project.findUnique({ where: { id: projectId }, select: { name: true } });
      const type = input.type ?? input.kind;
      if (!type) throw this.invalid({ type: "Укажите тип записи" });

      const fields = normaliseProjectLogFields(input);
      this.assertFields(type, fields);
      await this.assertConfirmsTx(tx, workspaceId, projectId, type, fields.confirmsEntryId, null);

      const taskIds = (input.tasks ?? []).map((item) => item.taskId);
      if (taskIds.length) {
        const tasks = await this.taskReferences.byIdsTx(tx, workspaceId, taskIds);
        if (tasks.length !== taskIds.length) throw new NotFoundException("Одна из задач не найдена в этом пространстве");
      }

      const row = await tx.projectLogEntry.create({
        data: {
          workspaceId,
          projectId,
          authorId: userId,
          type,
          text: input.text,
          rationale: fields.rationale,
          alternatives: fields.alternatives as unknown as Prisma.InputJsonValue,
          verificationDue: fields.verificationDue,
          confirmsEntryId: fields.confirmsEntryId,
          severity: fields.severity,
          resolution: fields.resolution,
          verdict: fields.verdict,
          source: "manual",
          tasks: { create: (input.tasks ?? []).map(({ taskId, comment }) => ({ workspaceId, taskId, comment })) }
        },
        include: entryInclude
      });
      return { entry: (await this.toDtos(tx, [row], userId, isManager(membership.role)))[0]!, projectName: project?.name ?? "" };
    });

    // Упоминания `@имя` (12.3) — та же механика, что в комментариях задач: формат `@имя` общий
    // (`parseMentions`), поэтому записи журнала и комментарии согласованы.
    await this.mentions.deliver({
      workspaceId,
      actorId: userId,
      body: input.text,
      entityType: "project",
      entityId: projectId,
      entityLabel: `проекте «${projectName}»`,
      notificationKind: "project_update",
      policyKind: "entity",
      eventKeyPrefix: `mention:project_log:${entry.id}`
    });
    return entry;
  }

  async updateEntry(userId: string, workspaceId: string, projectId: string, entryId: string, input: UpdateProjectLogEntryInput): Promise<ProjectLogEntry> {
    return this.prisma.withUser(userId, async (tx) => {
      const membership = await this.membershipTx(tx, userId, workspaceId);
      await this.assertProject(tx, workspaceId, projectId);
      const row = await tx.projectLogEntry.findUnique({ where: { id: entryId }, include: entryInclude });
      if (!row || row.workspaceId !== workspaceId || row.projectId !== projectId) throw new NotFoundException("Запись не найдена");
      if (row.source === "event") throw new ConflictException("Автоматическую запись журнала нельзя редактировать");
      if (row.authorId !== userId && !isManager(membership.role)) throw new ForbiddenException("Править запись может автор или менеджер проекта");

      const type = input.type ?? row.type;
      const fields = normaliseProjectLogFields({
        rationale: input.rationale ?? row.rationale,
        alternatives: input.alternatives ?? (Array.isArray(row.alternatives) ? row.alternatives : []),
        verificationDue: input.verificationDue !== undefined ? input.verificationDue : row.verificationDue?.toISOString() ?? null,
        confirmsEntryId: input.confirmsEntryId !== undefined ? input.confirmsEntryId : row.confirmsEntryId,
        severity: input.severity !== undefined ? input.severity : row.severity,
        resolution: input.resolution ?? row.resolution,
        verdict: input.verdict !== undefined ? input.verdict : row.verdict
      });
      this.assertFields(type, fields);
      await this.assertConfirmsTx(tx, workspaceId, projectId, type, fields.confirmsEntryId, entryId);

      const updated = await tx.projectLogEntry.update({
        where: { id: entryId },
        data: {
          type,
          ...(input.text !== undefined ? { text: input.text } : {}),
          rationale: fields.rationale,
          alternatives: fields.alternatives as unknown as Prisma.InputJsonValue,
          verificationDue: fields.verificationDue,
          confirmsEntryId: fields.confirmsEntryId,
          severity: fields.severity,
          resolution: fields.resolution,
          verdict: fields.verdict
        },
        include: entryInclude
      });
      return (await this.toDtos(tx, [updated], userId, isManager(membership.role)))[0]!;
    });
  }

  async removeEntry(userId: string, workspaceId: string, projectId: string, entryId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      const membership = await this.membershipTx(tx, userId, workspaceId);
      const row = await tx.projectLogEntry.findUnique({ where: { id: entryId } });
      if (!row || row.workspaceId !== workspaceId || row.projectId !== projectId) throw new NotFoundException("Запись не найдена");
      if (row.source === "event") throw new ConflictException("Автоматическая запись удаляется вместе с проектом");
      if (row.authorId !== userId && !isManager(membership.role)) throw new ForbiddenException("Удалить запись может автор или менеджер проекта");
      // У записи нет своей таблицы связей: материалы живут в EntityLink, и при
      // удалении записи её концы убирает единый сервис связей (FK на
      // полиморфную связь нет, каскад БД здесь не сработает).
      await this.entityLinks.removeForEntityTx(tx, workspaceId, "project_log_entry", entryId, userId);
      await tx.projectLogEntry.delete({ where: { id: entryId } });
    });
  }

  /**
   * Автозапись из domain events (задание 05). Вызывается подписчиком внутри
   * `asSystem`-транзакции диспетчера; идемпотентность — `dedupeKey` bulk-операции
   * через `createMany(skipDuplicates)`, чтобы повтор/второе событие того же
   * bulk не оставили ни ошибки транзакции, ни второй записи.
   */
  async recordAutoEntryTx(tx: Tx, input: AutoEntryInput): Promise<void> {
    const project = await tx.project.findFirst({ where: { id: input.projectId, workspaceId: input.workspaceId }, select: { id: true } });
    if (!project) return;
    const authorId = await this.autoAuthorTx(tx, input.workspaceId, input.actorId);
    if (!authorId) return;
    const dedupeKey = input.bulkId ? `bulk:${input.sourceEventType}:${input.bulkId}` : null;
    const data: Prisma.ProjectLogEntryCreateManyInput = {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      authorId,
      type: "change",
      text: input.text,
      source: "event",
      sourceEventId: input.sourceEventId,
      sourceEventType: input.sourceEventType,
      dedupeKey
    };
    await tx.projectLogEntry.createMany({ data: [data], skipDuplicates: true });
  }

  // ------------------------------------------------------------- relations

  async listRelations(userId: string, workspaceId: string, projectId: string): Promise<ProjectRelation[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.assertProject(tx, workspaceId, projectId);
      const rows = await tx.projectRelation.findMany({
        where: { workspaceId, OR: [{ fromProjectId: projectId }, { toProjectId: projectId }] },
        include: { fromProject: { select: { id: true, name: true } }, toProject: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      });
      return rows.map((row) => ({
        id: row.id, type: row.type, fromProjectId: row.fromProjectId, toProjectId: row.toProjectId,
        fromProjectName: row.fromProject.name, toProjectName: row.toProject.name,
        createdAt: row.createdAt.toISOString(), mine: row.createdById === userId
      }));
    });
  }

  async createRelation(userId: string, workspaceId: string, projectId: string, input: CreateProjectRelationInput): Promise<ProjectRelation> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.assertProject(tx, workspaceId, projectId);
      if (input.toProjectId === projectId) throw new ConflictException("Нельзя связать проект с самим собой");
      const target = await tx.project.findFirst({ where: { id: input.toProjectId, workspaceId }, select: { id: true, name: true } });
      if (!target) throw new NotFoundException("Связанный проект не найден в этом пространстве");
      const current = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true, name: true } });
      // "Связан с" is symmetric; persist one canonical direction so adding it from
      // the opposite project's page cannot create a duplicate pair.
      const from = input.type === "related" && current.id > target.id ? target : current;
      const to = input.type === "related" && current.id > target.id ? current : target;
      try {
        const row = await tx.projectRelation.create({ data: { workspaceId, fromProjectId: from.id, toProjectId: to.id, type: input.type, createdById: userId } });
        return { id: row.id, type: row.type, fromProjectId: from.id, toProjectId: to.id, fromProjectName: from.name, toProjectName: to.name, createdAt: row.createdAt.toISOString(), mine: true };
      } catch (error) {
        if (hasPrismaCode(error, "P2002")) throw new ConflictException("Такая связь уже добавлена");
        throw error;
      }
    });
  }

  async removeRelation(userId: string, workspaceId: string, projectId: string, relationId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const row = await tx.projectRelation.findUnique({ where: { id: relationId } });
      if (!row || row.workspaceId !== workspaceId || (row.fromProjectId !== projectId && row.toProjectId !== projectId) || row.createdById !== userId) {
        throw new NotFoundException("Связь не найдена");
      }
      await tx.projectRelation.delete({ where: { id: relationId } });
    });
  }

  // ---------------------------------------------------------------- helpers

  private async listTx(
    tx: Tx,
    userId: string,
    workspaceId: string,
    projectIds: string[] | null,
    filters: ProjectLogQuery,
    manager: boolean
  ): Promise<ProjectLogEntry[]> {
    const rows = await tx.projectLogEntry.findMany({
      where: this.whereTx(workspaceId, projectIds, filters),
      include: entryInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: Math.min(filters.limit ?? ENTRY_LIMIT, ENTRY_LIMIT)
    });
    return this.toDtos(tx, rows, userId, manager);
  }

  private whereTx(workspaceId: string, projectIds: string[] | null, filters: ProjectLogQuery): Prisma.ProjectLogEntryWhereInput {
    const where: Prisma.ProjectLogEntryWhereInput = { workspaceId };
    if (projectIds) where.projectId = { in: projectIds };
    if (filters.type) where.type = filters.type;
    if (filters.authorId) where.authorId = filters.authorId;
    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {})
      };
    }
    if (filters.hasTasks === "true") where.tasks = { some: {} };
    if (filters.hasTasks === "false") where.tasks = { none: {} };
    return where;
  }

  /**
   * Проекты, которые попадают в выборку. `Project.parentId` (задание 03)
   * появляется не одновременно с журналом, поэтому колонка проверяется в
   * information_schema: без иерархии фильтр работает как «этот проект».
   */
  private async projectScopeTx(tx: Tx, workspaceId: string, rootIds: string[], includeChildren: boolean): Promise<string[]> {
    if (!includeChildren || rootIds.length === 0) return rootIds;
    const [column] = await tx.$queryRaw<Array<{ present: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'projects' AND column_name = 'parentId'
      ) AS "present"`;
    if (!column?.present) return rootIds;
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH RECURSIVE tree AS (
        SELECT "id" FROM "projects" WHERE "workspaceId" = ${workspaceId} AND "id" IN (${Prisma.join(rootIds)})
        UNION
        SELECT p."id" FROM "projects" p
        JOIN tree t ON p."parentId" = t."id"
        WHERE p."workspaceId" = ${workspaceId}
      )
      SELECT "id" FROM tree`);
    return rows.map((row) => row.id);
  }

  private async membershipTx(tx: Tx, userId: string, workspaceId: string) {
    return this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "member", "lead"]);
  }

  private async assertProject(tx: Tx, workspaceId: string, projectId: string): Promise<void> {
    const project = await tx.project.findFirst({ where: { id: projectId, workspaceId }, select: { id: true } });
    if (!project) throw new NotFoundException("Проект не найден");
  }

  private async assertConfirmsTx(
    tx: Tx,
    workspaceId: string,
    projectId: string,
    type: ProjectLogType,
    confirmsEntryId: string | null,
    selfId: string | null
  ): Promise<void> {
    if (!confirmsEntryId) return;
    if (type !== "result") throw this.invalid({ confirmsEntryId: "Ссылка на гипотезу/решение допустима только для результата" });
    if (selfId && confirmsEntryId === selfId) throw this.invalid({ confirmsEntryId: "Результат не может подтверждать сам себя" });
    const target = await tx.projectLogEntry.findUnique({
      where: { id: confirmsEntryId },
      select: { workspaceId: true, projectId: true, type: true }
    });
    if (!target || target.workspaceId !== workspaceId || target.projectId !== projectId) {
      throw this.invalid({ confirmsEntryId: "Подтверждаемая запись не найдена в этом проекте" });
    }
    if (target.type !== "hypothesis" && target.type !== "decision") {
      throw this.invalid({ confirmsEntryId: "Результат может подтверждать только гипотезу или решение" });
    }
  }

  private assertFields(type: ProjectLogType, fields: NormalisedProjectLogFields): void {
    const errors = validateProjectLogFields(type, fields);
    if (Object.keys(errors).length) throw this.invalid(errors);
  }

  private invalid(errors: Record<string, string>): UnprocessableEntityException {
    return new UnprocessableEntityException({
      statusCode: 422,
      code: "logbook_entry_invalid",
      message: "Поля записи не соответствуют её типу",
      errors
    });
  }

  private async autoAuthorTx(tx: Tx, workspaceId: string, actorId: string | null): Promise<string | null> {
    if (actorId) {
      const member = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: actorId } }, select: { userId: true } });
      if (member) return member.userId;
    }
    const owner = await tx.workspaceMember.findFirst({
      where: { workspaceId, role: "owner" },
      select: { userId: true },
      orderBy: { createdAt: "asc" }
    });
    if (owner) return owner.userId;
    const any = await tx.workspaceMember.findFirst({ where: { workspaceId }, select: { userId: true }, orderBy: { createdAt: "asc" } });
    return any?.userId ?? null;
  }

  private async toDtos(tx: Tx, rows: EntryModel[], userId: string, manager: boolean): Promise<ProjectLogEntry[]> {
    const workspaceId = rows[0]?.workspaceId ?? "";
    const taskDetails = await this.taskDetails(tx, workspaceId, rows.flatMap((row) => row.tasks.map((link) => link.taskId)));
    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      type: row.type,
      kind: row.type,
      text: row.text,
      authorId: row.authorId,
      authorName: row.author.name,
      mine: row.authorId === userId,
      rationale: row.rationale,
      alternatives: readProjectLogAlternatives(row.alternatives),
      verificationDue: row.verificationDue?.toISOString() ?? null,
      confirmsEntryId: row.confirmsEntryId,
      severity: row.severity,
      resolution: row.resolution,
      verdict: row.verdict,
      source: row.source,
      sourceEventId: row.sourceEventId,
      sourceEventType: row.sourceEventType,
      editable: row.source === "manual" && (row.authorId === userId || manager),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      tasks: row.tasks.flatMap(({ taskId, comment }) => {
        const task = taskDetails.get(taskId);
        return task ? [{ ...task, comment, url: null }] : [];
      })
    }));
  }

  private async taskDetails(tx: Tx, workspaceId: string, taskIds: string[]) {
    if (!taskIds.length || !workspaceId) return new Map<string, { id: string; title: string; status: string; projectId: string | null; projectName: string | null }>();
    const tasks = await this.taskReferences.byIdsTx(tx, workspaceId, [...new Set(taskIds)]);
    const projectIds = [...new Set(tasks.flatMap((task) => (task.projectId ? [task.projectId] : [])))];
    const projects = projectIds.length ? await tx.project.findMany({ where: { workspaceId, id: { in: projectIds } }, select: { id: true, name: true } }) : [];
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    return new Map(tasks.map((task) => [task.id, {
      id: task.id, title: task.title, status: task.status, projectId: task.projectId,
      projectName: task.projectId ? projectNames.get(task.projectId) ?? null : null
    }]));
  }
}

// `toDtos` is called from inside `withUser` for list/create/update, where the
// task projection must share that RLS transaction.

function isManager(role: string): boolean {
  return role === "owner" || role === "lead";
}

function hasPrismaCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}
