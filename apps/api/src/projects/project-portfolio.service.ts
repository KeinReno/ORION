import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  PROJECT_PORTFOLIO_DEFAULT_LIMIT,
  PROJECT_PORTFOLIO_MAX_LIMIT,
  compareProjectsByLifecycle,
  deadlineDaysLeft,
  highestRiskLevel,
  isProjectOverdue,
  projectRiskKinds,
  projectTaskRollup,
  projectPortfolioRiskLevelOf,
  type OrionModuleId,
  type ProjectPortfolio,
  type ProjectPortfolioItem,
  type ProjectPortfolioQuery,
  type ProjectPortfolioRisk,
  type ProjectPortfolioWorkload
} from "@orion/shared-types";
import { ProjectAggregateRegistry, type ProjectAggregate } from "../common/project-aggregates";
import { PrismaService } from "../common/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

/**
 * Сколько проектов портфель агрегирует за один запрос. Явный лимит вместо «посчитаем всё»:
 * портфель бывает большим, а агрегаты в памяти (CTE по задачам/вехам на 500 проектов — это
 * уже десятки тысяч строк). `page.truncated` говорит клиенту, что цифры — по первым N.
 */
const PORTFOLIO_SCAN_LIMIT = 500;
const DEADLINES_LIMIT = 10;
const RISKS_LIMIT = 50;

@Injectable()
export class ProjectPortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService,
    private readonly aggregates: ProjectAggregateRegistry
  ) {}

  async get(userId: string, workspaceId: string, query: ProjectPortfolioQuery): Promise<ProjectPortfolio> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const enabled = await this.modules.accessibleSetTx(tx, userId, workspaceId);
      const limit = Math.min(query.limit ?? PROJECT_PORTFOLIO_DEFAULT_LIMIT, PROJECT_PORTFOLIO_MAX_LIMIT);
      const offset = query.offset ?? 0;
      const now = new Date();

      const where = this.whereFor(workspaceId, query);
      const totalMatching = await tx.project.count({ where });
      const rows = await tx.project.findMany({ where, take: PORTFOLIO_SCAN_LIMIT });
      rows.sort(compareProjectsByLifecycle);

      const ids = rows.map((row) => row.id);
      const [contributions, relations] = await Promise.all([
        this.contributions(tx, ids, enabled, now),
        this.dependenciesTx(tx, workspaceId, ids)
      ]);

      // Фильтр «участник» применяется после агрегатов: «открытые задачи участника» есть
      // только у владельца задач, в SQL портфеля этой таблицы нет.
      const filtered = query.memberId
        ? rows.filter((row) => (contributions.get("tasks")?.get(row.id)?.openTasksByAssignee ?? []).some((item) => item.assigneeId === query.memberId && item.count > 0))
        : rows;

      const computed = filtered.map((row) => {
        const part = (providerId: string): ProjectAggregate => contributions.get(providerId)?.get(row.id) ?? {};
        const rollup = projectTaskRollup(part("tasks").taskStatusCounts ?? []);
        const openTasks = (part("tasks").taskStatusCounts ?? []).filter((entry) => !isClosedStatus(entry.status)).reduce((sum, entry) => sum + entry.count, 0);
        const risks = projectRiskKinds({
          hasTasks: rollup.taskCount > 0,
          hasDates: Boolean(row.startAt || row.dueAt),
          overdue: isProjectOverdue(row, now),
          milestoneWithoutDates: part("milestones").milestonesWithoutDates ?? [],
          blockedDependencies: relations.get(row.id) ?? []
        });
        const item: ProjectPortfolioItem = {
          id: row.id,
          name: row.name,
          status: row.status as ProjectPortfolioItem["status"],
          parentId: row.parentId,
          archivedAt: row.archivedAt?.toISOString() ?? null,
          startAt: row.startAt?.toISOString() ?? null,
          dueAt: row.dueAt?.toISOString() ?? null,
          progress: rollup.progress,
          tasks: rollup.taskCount,
          openTasks,
          overdue: isProjectOverdue(row, now),
          riskLevel: highestRiskLevel(risks.map((risk) => risk.kind))
        };
        return {
          item,
          risks: risks.map((risk): ProjectPortfolioRisk => ({
            projectId: row.id,
            projectName: row.name,
            kind: risk.kind,
            level: projectPortfolioRiskLevelOf(risk.kind),
            detail: risk.detail
          }))
        };
      });
      const items = computed.map((entry) => entry.item);

      const risks = computed
        .flatMap((entry) => entry.risks)
        .sort((a, b) => riskRank(b.level) - riskRank(a.level) || a.projectName.localeCompare(b.projectName, "ru"));

      const deadlines = items
        .flatMap((item) => (item.dueAt && item.status !== "completed" ? [{ item, at: item.dueAt }] : []))
        .filter(({ at }) => deadlineDaysLeft(at, now) >= 0)
        .sort((a, b) => a.at.localeCompare(b.at))
        .slice(0, DEADLINES_LIMIT)
        .map(({ item, at }) => ({ projectId: item.id, name: item.name, dueAt: at, daysLeft: deadlineDaysLeft(at, now) }));

      const workload = await this.workloadTx(tx, workspaceId, items, contributions, query.memberId);

      const byStatus = (["active", "on_hold", "completed"] as const)
        .map((status) => ({ status, count: items.filter((item) => item.status === status).length }))
        .filter((entry) => entry.count > 0);

      return {
        generatedAt: now.toISOString(),
        totals: {
          projects: filtered.length,
          byStatus,
          tasks: items.reduce((sum, item) => sum + item.tasks, 0),
          openTasks: items.reduce((sum, item) => sum + item.openTasks, 0),
          overdueProjects: items.filter((item) => item.overdue).length,
          projectsAtRisk: items.filter((item) => item.riskLevel !== null).length
        },
        items: items.slice(offset, offset + limit),
        page: {
          // При фильтре по участнику «всего» — это уже отфильтрованный набор: иначе
          // клиент видел бы total, не соответствующий ни items, ни totals.
          total: query.memberId ? filtered.length : totalMatching,
          offset,
          limit,
          truncated: totalMatching > PORTFOLIO_SCAN_LIMIT || (query.memberId !== undefined && rows.length >= PORTFOLIO_SCAN_LIMIT)
        },
        deadlines,
        risks: risks.slice(0, RISKS_LIMIT),
        workload
      };
    });
  }

  private whereFor(workspaceId: string, query: ProjectPortfolioQuery): Prisma.ProjectWhereInput {
    const scope = query.scope ?? "active";
    const where: Prisma.ProjectWhereInput = { workspaceId };
    if (scope === "active") where.archivedAt = null;
    else if (scope === "archived") where.archivedAt = { not: null };
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      // Дата-окно — по сроку проекта. Проект без срока в окно не попадает: «сроки
      // в марте» не должны приносить проект, у которого срока нет вовсе.
      where.dueAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {})
      };
    }
    return where;
  }

  private async contributions(tx: Prisma.TransactionClient, ids: string[], enabled: Set<OrionModuleId>, now: Date) {
    const entries = await Promise.all(
      this.aggregates
        .providers()
        .filter((provider) => provider.aggregate && (provider.moduleId === null || enabled.has(provider.moduleId)))
        .map(async (provider) => [provider.id, await provider.aggregate!(tx, ids, now)] as const)
    );
    return new Map(entries);
  }

  /**
   * «Зависимость от заблокированного проекта»: направленные связи `depends_on` проекта,
   * чей адресат на паузе или в архиве. Связи принадлежат проектам, поэтому читаются здесь.
   */
  private async dependenciesTx(tx: Prisma.TransactionClient, workspaceId: string, ids: string[]): Promise<Map<string, string[]>> {
    if (ids.length === 0) return new Map();
    const relations = await tx.projectRelation.findMany({
      where: { workspaceId, type: "depends_on", fromProjectId: { in: ids } },
      select: { fromProjectId: true, toProjectId: true }
    });
    if (relations.length === 0) return new Map();
    const targets = await tx.project.findMany({
      where: { workspaceId, id: { in: [...new Set(relations.map((relation) => relation.toProjectId))] } },
      select: { id: true, name: true, status: true, archivedAt: true }
    });
    const blocked = new Map(targets.filter((target) => target.archivedAt !== null || target.status === "on_hold").map((target) => [target.id, target.name]));
    const result = new Map<string, string[]>();
    for (const relation of relations) {
      const name = blocked.get(relation.toProjectId);
      if (!name) continue;
      const list = result.get(relation.fromProjectId) ?? [];
      list.push(name);
      result.set(relation.fromProjectId, list);
    }
    return result;
  }

  /** Загрузка по участникам: открытые задачи всех проектов портфеля, сведённые по исполнителю. */
  private async workloadTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    items: ProjectPortfolioItem[],
    contributions: Map<string, Map<string, ProjectAggregate>>,
    memberId: string | undefined
  ): Promise<ProjectPortfolioWorkload[]> {
    const totals = new Map<string, number>();
    for (const item of items) {
      for (const entry of contributions.get("tasks")?.get(item.id)?.openTasksByAssignee ?? []) {
        if (!entry.assigneeId) continue;
        totals.set(entry.assigneeId, (totals.get(entry.assigneeId) ?? 0) + entry.count);
      }
    }
    const ids = [...totals.keys()].filter((id) => (memberId ? id === memberId : true));
    if (ids.length === 0) return [];
    const members = await tx.workspaceMember.findMany({
      where: { workspaceId, id: { in: ids } },
      select: { id: true, user: { select: { name: true } } }
    });
    const names = new Map(members.map((member) => [member.id, member.user?.name ?? null]));
    return ids
      .map((id) => ({ memberId: id, name: names.get(id) ?? null, openTasks: totals.get(id) ?? 0 }))
      .sort((a, b) => b.openTasks - a.openTasks || (a.name ?? "").localeCompare(b.name ?? "", "ru"));
  }
}

function isClosedStatus(status: string): boolean {
  // Единое правило «задача закрыта» из контракта — не сравнение со строкой "done" здесь.
  return status === "done" || status === "canceled";
}

function riskRank(level: ProjectPortfolioRisk["level"]): number {
  return level === "high" ? 2 : level === "medium" ? 1 : 0;
}
