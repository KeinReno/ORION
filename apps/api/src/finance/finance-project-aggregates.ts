import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ProjectActivity } from "@orion/shared-types";
import { ProjectAggregateRegistry, type ProjectAggregate, type ProjectAggregateProvider } from "../common/project-aggregates";

/** Что модуль «Финансы» сообщает карточке проекта (расходы по валютам, активность) — вместо `tx.transaction*` внутри projects. */
@Injectable()
export class FinanceProjectAggregates implements ProjectAggregateProvider {
  readonly id = "finance" as const;
  readonly moduleId = "finance" as const;
  readonly order = 50;

  constructor(registry: ProjectAggregateRegistry) {
    registry.register(this);
  }

  async aggregate(tx: Prisma.TransactionClient, ids: string[]): Promise<Map<string, ProjectAggregate>> {
    const [lines, latest] = await Promise.all([
      tx.transactionLine.findMany({
        where: { transaction: { projectId: { in: ids }, type: "expense" } },
        // Валюта расхода — валюта счёта-источника (как в budgetSpentTx).
        select: { amount: true, transaction: { select: { projectId: true, account: { select: { currency: true } } } } }
      }),
      tx.transaction.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _max: { updatedAt: true } })
    ]);
    const map = new Map<string, ProjectAggregate>();
    const entryOf = (projectId: string): ProjectAggregate => map.get(projectId) ?? map.set(projectId, {}).get(projectId)!;
    // Копейки разных валют не складываются: сумма ведётся отдельно по каждой валюте.
    for (const line of lines) {
      const projectId = line.transaction.projectId;
      if (!projectId) continue;
      const spent = (entryOf(projectId).spent ??= []);
      const currency = line.transaction.account.currency;
      const bucket = spent.find((item) => item.currency === currency);
      if (bucket) bucket.amount += line.amount;
      else spent.push({ currency, amount: line.amount });
    }
    for (const entry of latest) if (entry.projectId && entry._max.updatedAt) entryOf(entry.projectId).lastActivityAt = entry._max.updatedAt;
    return map;
  }

  async recentActivity(tx: Prisma.TransactionClient, projectId: string): Promise<ProjectActivity[]> {
    const rows = await tx.transaction.findMany({
      where: { projectId },
      select: { id: true, note: true, type: true, updatedAt: true },
      take: 20,
      orderBy: { updatedAt: "desc" }
    });
    return rows.map((item) => ({
      id: item.id,
      type: "transaction" as const,
      title: item.note || "Финансовая операция",
      at: item.updatedAt.toISOString(),
      status: item.type
    }));
  }
}
