import { Injectable } from "@nestjs/common";
import { isTaskClosed, type MyOverview } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { computeNetByAccount } from "../finance/finance-refs.util";
import { ModulesService } from "../modules/modules.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

/**
 * U08 "Личный межпространственный обзор" (24-CONNECTED-CORE-BACKLOG.md,
 * done-criterion: "Источник каждой записи видим; scope создания явный;
 * суммы по валютам и без дублей; read-only account не предлагается для
 * списания; нет утечки через search/export/count").
 *
 * This is *not* a new access path. `WorkspacesService.listForUser` already
 * returns every workspace the caller is a member of (used by U05's sphere
 * switcher); this service loops over that list and re-reads each workspace
 * through its **own** `PrismaService.withUser(userId, …)` transaction — the
 * same RLS-respecting call every other per-workspace read already makes.
 * There is deliberately no single cross-workspace query: joining across
 * workspaces at the SQL level, even filtered by membership in application
 * code afterwards, is exactly the kind of "weaken RLS for a universal
 * search" shortcut 24-CONNECTED-CORE-BACKLOG.md's "Правила исполнения"
 * forbids. N+1 per-workspace queries is the deliberate, safe shape here —
 * personal workspace counts are tiny (single digits), so the extra round
 * trips are not a real cost.
 */
@Injectable()
export class OverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService
  ) {}

  async getMyOverview(userId: string): Promise<MyOverview> {
    const memberships = await this.workspaces.listForUser(userId);

    // R28-01 fix: `disabledModules` alone (via isModuleEnabled) only covers
    // "disabled for everyone" — it ignores `restrictedModules`, which closes
    // a module for plain `member`s while leaving it open for owner/lead. The
    // combined, actor-aware check is `ModulesService.accessibleSetTx`, the
    // same primitive `SearchService`/notification center already use — it
    // must be read fresh per workspace, inside that workspace's own
    // `withUser` transaction below, because the caller's role differs per
    // workspace and the set is not something we can compute once outside.
    const accessibleByWorkspace = new Map<string, Set<string>>();
    for (const ws of memberships) {
      const accessible = await this.prisma.withUser(userId, (tx) => this.modules.accessibleSetTx(tx, userId, ws.id));
      accessibleByWorkspace.set(ws.id, accessible);
    }

    const workspaces = memberships.map((ws) => {
      const accessible = accessibleByWorkspace.get(ws.id)!;
      return {
        id: ws.id,
        name: ws.name,
        tasksEnabled: accessible.has("tasks"),
        financeEnabled: accessible.has("finance")
      };
    });

    const tasks: MyOverview["tasks"] = [];
    const accounts: MyOverview["accounts"] = [];

    for (const ws of workspaces) {
      if (ws.tasksEnabled) {
        // Own withUser transaction per workspace — RLS is evaluated fresh
        // for each one under this caller's own current_user_id, never
        // reused across workspace boundaries.
        const wsTasks = await this.prisma.withUser(userId, async (tx) => {
          const membership = await tx.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: ws.id, userId } }
          });
          if (!membership) return [];
          return tx.task.findMany({
            where: { workspaceId: ws.id, assigneeId: membership.id },
            include: { dependsOn: { include: { dependsOn: { select: { status: true } } } } },
            orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }]
          });
        });
        for (const task of wsTasks) {
          if (isTaskClosed(task.status)) continue;
          tasks.push({
            id: task.id,
            revision: task.revision,
            workspaceId: task.workspaceId,
            workspaceName: ws.name,
            projectId: task.projectId,
            parentId: task.parentId,
            title: task.title,
            description: task.description,
            status: task.status,
            priority: task.priority,
            dueAt: task.dueAt?.toISOString() ?? null,
            projectTag: task.projectTag,
            recurrence: task.recurrence as MyOverview["tasks"][number]["recurrence"],
            completedAt: task.completedAt?.toISOString() ?? null,
            sortOrder: task.sortOrder,
            dependencyIds: task.dependsOn.map((d) => d.dependsOnTaskId),
            blocked: task.dependsOn.some((d) => !isTaskClosed(d.dependsOn.status)),
            assigneeId: task.assigneeId,
            startAt: task.startAt?.toISOString() ?? null,
            estimatedMinutes: task.estimatedMinutes,
            milestoneId: task.milestoneId,
            createdAt: task.createdAt.toISOString(),
            updatedAt: task.updatedAt.toISOString()
          });
        }
      }

      if (ws.financeEnabled) {
        const { wsAccounts, netByAccount } = await this.prisma.withUser(userId, async (tx) => {
          const wsAccounts = await tx.account.findMany({ where: { workspaceId: ws.id, archivedAt: null } });
          const netByAccount = await computeNetByAccount(tx, ws.id);
          return { wsAccounts, netByAccount };
        });
        for (const account of wsAccounts) {
          accounts.push({
            id: account.id,
            workspaceId: account.workspaceId,
            workspaceName: ws.name,
            name: account.name,
            kind: account.kind as MyOverview["accounts"][number]["kind"],
            context: account.context as MyOverview["accounts"][number]["context"],
            currency: account.currency,
            startingBalance: account.startingBalance,
            balance: account.startingBalance + (netByAccount.get(account.id) ?? 0),
            archivedAt: null,
            createdAt: account.createdAt.toISOString(),
            updatedAt: account.updatedAt.toISOString()
          });
        }
      }
    }

    // Dedup by account id before summing — a user cannot really be a member
    // of the same workspace twice (workspaceId_userId is a unique
    // constraint), but the aggregate is defensive rather than trusting that
    // invariant implicitly (U08 done-criterion "без дублей").
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const totals = new Map<string, number>();
    for (const account of byId.values()) {
      totals.set(account.currency, (totals.get(account.currency) ?? 0) + account.balance);
    }

    return {
      workspaces,
      tasks,
      accounts,
      balancesByCurrency: [...totals.entries()]
    };
  }
}
