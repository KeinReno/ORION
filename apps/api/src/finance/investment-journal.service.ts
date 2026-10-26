import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { InvestmentTrade, TradeMode, TradeImportInput, TradeImportResult, RecordTradeFeeInput } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { assertAccountInWorkspace, assertCategoryInWorkspace } from "./finance-refs.util";
import { InvestmentJournal } from "./public/investment-journal";

/** Existing journal rules; Finance currently owns InvestmentTrade in the migration map. */
@Injectable()
export class InvestmentJournalService extends InvestmentJournal {
  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspacesService) { super(); }

  async listTrades(userId: string, workspaceId: string, mode?: TradeMode): Promise<InvestmentTrade[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.investmentTrade.findMany({ where: { workspaceId, ...(mode ? { mode } : {}) }, orderBy: [{ tradedAt: "desc" }, { id: "asc" }], take: 5000 });
    });
    return rows.map(toTradeDto);
  }

  /** A dry run reports what a real run would add (and writes nothing); the same uid is never added twice. */
  async importTrades(userId: string, workspaceId: string, input: TradeImportInput): Promise<TradeImportResult> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const uids = input.entries.map((entry) => `${input.source}:${entry.uid}`);
      const existing = await tx.investmentTrade.findMany({ where: { workspaceId, externalUid: { in: uids } }, select: { externalUid: true } });
      const known = new Set(existing.map((row) => row.externalUid));
      const fresh = input.entries.filter((entry) => {
        const key = `${input.source}:${entry.uid}`;
        if (known.has(key)) return false;
        known.add(key);
        return true;
      });
      const byMode = { real: 0, paper: 0, historical: 0 };
      for (const entry of fresh) byMode[entry.mode] += 1;
      if (!input.dryRun && fresh.length > 0) {
        await tx.investmentTrade.createMany({
          data: fresh.map((entry) => ({
            workspaceId,
            externalUid: `${input.source}:${entry.uid}`,
            source: input.source,
            mode: entry.mode,
            market: entry.market.toLowerCase(),
            symbol: entry.symbol.toUpperCase(),
            side: entry.side,
            qty: entry.qty,
            price: entry.price,
            fee: entry.fee,
            tradedAt: new Date(entry.ts),
            note: entry.note
          }))
        });
      }
      return { dryRun: input.dryRun, imported: fresh.length, duplicates: input.entries.length - fresh.length, byMode };
    });
  }

  async removeTrade(userId: string, workspaceId: string, tradeId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const existing = await tx.investmentTrade.findUnique({ where: { id: tradeId } });
      if (!existing || existing.workspaceId !== workspaceId) throw new NotFoundException("Сделка не найдена");
      // The fee operation, if one was recorded, stays in the ledger: it is a real expense of the workspace.
      await tx.investmentTrade.delete({ where: { id: tradeId } });
    });
  }

  async recordFee(userId: string, workspaceId: string, tradeId: string, input: RecordTradeFeeInput): Promise<InvestmentTrade> {
    try {
      const row = await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
        const trade = await tx.investmentTrade.findUnique({ where: { id: tradeId } });
        if (!trade || trade.workspaceId !== workspaceId) throw new NotFoundException("Сделка не найдена");
        if (trade.mode !== "real") throw new ConflictException("Комиссию можно записать только у реальной сделки");
        if (trade.feeTransactionId) throw new ConflictException("Комиссия этой сделки уже записана в финансы");
        await assertAccountInWorkspace(tx, workspaceId, input.accountId);
        let categoryId: string | null = null;
        if (input.categoryId) {
          await assertCategoryInWorkspace(tx, workspaceId, input.categoryId);
          const category = await tx.financeCategory.findUnique({ where: { id: input.categoryId } });
          categoryId = category?.kind === "expense" ? category.id : null;
        }
        const transaction = await tx.transaction.create({
          data: {
            workspaceId,
            accountId: input.accountId,
            toAccountId: null,
            type: "expense",
            note: `Комиссия: ${trade.side === "buy" ? "покупка" : "продажа"} ${trade.symbol}`,
            tags: ["инвестиции"],
            importedRef: `investments:fee:${trade.id}`,
            occurredAt: trade.tradedAt,
            lines: { create: [{ workspaceId, categoryId, amount: input.amount }] }
          }
        });
        return tx.investmentTrade.update({ where: { id: trade.id }, data: { feeTransactionId: transaction.id } });
      });
      return toTradeDto(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Комиссия этой сделки уже записана в финансы");
      }
      throw error;
    }
  }
}

type TradeRow = {
  id: string;
  workspaceId: string;
  externalUid: string;
  source: string;
  mode: string;
  market: string;
  symbol: string;
  side: string;
  qty: number;
  price: number;
  fee: number;
  tradedAt: Date;
  note: string;
  feeTransactionId: string | null;
  importedAt: Date;
};

function toTradeDto(row: TradeRow): InvestmentTrade {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    externalUid: row.externalUid,
    source: row.source,
    mode: row.mode as TradeMode,
    market: row.market,
    symbol: row.symbol,
    side: row.side === "sell" ? "sell" : "buy",
    qty: row.qty,
    price: row.price,
    fee: row.fee,
    tradedAt: row.tradedAt.toISOString(),
    note: row.note,
    feeTransactionId: row.feeTransactionId,
    importedAt: row.importedAt.toISOString()
  };
}
