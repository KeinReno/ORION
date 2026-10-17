import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Account, CreateAccountInput, UpdateAccountInput } from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { computeNetByAccount } from "../finance-refs.util";

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  /**
   * Balance is never stored — it's startingBalance plus a net of every
   * transaction touching the account, computed here for every account in
   * the workspace at once. One fewer place for the truth to drift, and
   * cheap at personal-workspace data volumes.
   *
   * `includeArchived` defaults to `false` — an archived account is meant to
   * disappear from day-to-day use (new transactions, transfer targets)
   * while its history stays intact; the accounts view/manager pass `true`
   * explicitly to show it again.
   */
  async list(userId: string, workspaceId: string, includeArchived = false): Promise<Account[]> {
    const { accounts, netByAccount } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const accounts = await tx.account.findMany({
        where: { workspaceId, ...(includeArchived ? {} : { archivedAt: null }) },
        orderBy: { createdAt: "asc" }
      });
      const netByAccount = await computeNetByAccount(tx, workspaceId);
      return { accounts, netByAccount };
    });
    return accounts.map((account) => toDto(account, netByAccount.get(account.id) ?? 0));
  }

  async create(userId: string, workspaceId: string, input: CreateAccountInput): Promise<Account> {
    const account = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.account.create({
        data: {
          workspaceId,
          name: input.name,
          kind: input.kind,
          context: input.context,
          // Whoever creates an account owns it; `private` hides it from everyone else at the database level.
          visibility: input.visibility,
          ownerId: userId,
          // `currency` was accepted by the contract since v0.14 but never
          // persisted — the column kept its 'RUB' default whatever the user
          // sent. Same class of bug as `archivedAt` in v0.13.
          currency: input.currency,
          startingBalance: input.startingBalance
        }
      });
    });
    return toDto(account, 0);
  }

  async update(userId: string, workspaceId: string, accountId: string, input: UpdateAccountInput): Promise<Account> {
    const { account, net } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const existing = await this.assertOwnedTx(tx, workspaceId, accountId);
      const data: Prisma.AccountUpdateInput = { ...input };
      if (input.visibility === "private" && existing.visibility !== "private") {
        // Hiding a shared account takes it away from everyone else, so not any member may do it: the one who created
        // it, or — for accounts older than the owner column — the owner of the workspace.
        const member = await tx.workspaceMember.findFirst({ where: { workspaceId, userId }, select: { role: true } });
        const mayHide = existing.ownerId === userId || (existing.ownerId === null && member?.role === "owner");
        if (!mayHide) throw new ForbiddenException("Скрыть общий счёт может тот, кто его завёл (для старых счетов — владелец пространства)");
        data.ownerId = userId;
      }
      const account = await tx.account.update({ where: { id: accountId }, data });
      const netByAccount = await computeNetByAccount(tx, workspaceId);
      return { account, net: netByAccount.get(accountId) ?? 0 };
    });
    return toDto(account, net);
  }

  async remove(userId: string, workspaceId: string, accountId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, accountId);
      await tx.account.delete({ where: { id: accountId } });
    });
  }

  /**
   * Reconciliation, the simple way (see docs/HISTORY.md v0.13): no per-
   * transaction cleared/uncleared ledger, just "here's what the bank
   * actually says" → if it disagrees with the computed balance, one
   * corrective `Transaction` closes the gap. `diff === 0` is a no-op —
   * the account is returned unchanged, no empty adjustment row created.
   */
  async reconcile(userId: string, workspaceId: string, accountId: string, actualBalance: number): Promise<Account> {
    const { account, net } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const existing = await this.assertOwnedTx(tx, workspaceId, accountId);
      const netByAccount = await computeNetByAccount(tx, workspaceId);
      const currentNet = netByAccount.get(accountId) ?? 0;
      const diff = actualBalance - (existing.startingBalance + currentNet);
      if (diff !== 0) {
        await tx.transaction.create({
          data: {
            workspaceId,
            accountId,
            type: diff > 0 ? "income" : "expense",
            note: "Сверка баланса",
            occurredAt: new Date(),
            lines: { create: [{ workspaceId, categoryId: null, amount: Math.abs(diff) }] }
          }
        });
      }
      return { account: existing, net: currentNet + diff };
    });
    return toDto(account, net);
  }

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, accountId: string): Promise<AccountRow> {
    const account = await tx.account.findUnique({ where: { id: accountId } });
    if (!account || account.workspaceId !== workspaceId) {
      throw new NotFoundException("Счёт не найден");
    }
    return account;
  }
}

type AccountRow = {
  id: string;
  workspaceId: string;
  name: string;
  kind: string;
  context: string;
  visibility: string;
  ownerId: string | null;
  currency: string;
  startingBalance: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toDto(account: AccountRow, net: number): Account {
  return {
    id: account.id,
    workspaceId: account.workspaceId,
    name: account.name,
    kind: account.kind as Account["kind"],
    context: account.context as Account["context"],
    visibility: account.visibility === "private" ? "private" : "workspace",
    ownerId: account.ownerId,
    currency: account.currency,
    startingBalance: account.startingBalance,
    balance: account.startingBalance + net,
    archivedAt: account.archivedAt ? account.archivedAt.toISOString() : null,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString()
  };
}
