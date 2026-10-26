import { Injectable } from "@nestjs/common";
import type { MyOverview } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { FinanceOverviewReader } from "../finance/public/finance-overview-reader";
import { TaskOverviewReader } from "../tasks/public/task-overview-reader";
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
    private readonly modules: ModulesService,
    private readonly taskReader: TaskOverviewReader,
    private readonly financeReader: FinanceOverviewReader
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
          return this.taskReader.assignedTx(tx, ws.id, membership.id);
        });
        tasks.push(...wsTasks.map(task => ({ ...task, workspaceName: ws.name })));
      }

      if (ws.financeEnabled) {
        const wsAccounts = await this.prisma.withUser(userId, tx => this.financeReader.accountsTx(tx, ws.id));
        accounts.push(...wsAccounts.map(account => ({ ...account, workspaceName: ws.name })));
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
