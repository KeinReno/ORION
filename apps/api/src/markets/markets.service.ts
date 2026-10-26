import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateWatchItemInput,
  InvestmentTrade,
  RecordTradeFeeInput,
  TradeImportInput,
  TradeImportResult,
  TradeMode,
  UpdateWatchItemInput,
  WatchItem
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { InvestmentJournal } from "../finance/public/investment-journal";
import { WorkspacesService } from "../workspaces/workspaces.service";

/**
 * «Рынки»: a watchlist (references to instruments) and the journal of trades a person loaded from a Compass backup.
 *
 * Boundaries this service holds on purpose:
 * - quotes, charts, strategies and back-tests stay in Compass — nothing here computes or stores them;
 * - a trade keeps its `mode` (real / paper / historical) for ever, and only the client's position maths reads real ones;
 * - a trade is NEVER a finance transaction by itself. Buying or selling an asset is an investment event, not an expense.
 *   The one bridge is `recordFee`: the person explicitly turns the fee of a REAL trade into an expense, picking the
 *   account and confirming the amount (Compass fees are in the market's currency and ORION invents no exchange rate).
 *   It is idempotent — a second press is a 409, not a second expense.
 */
@Injectable()
export class MarketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly trades: InvestmentJournal
  ) {}

  // ---- watchlist

  async listWatch(userId: string, workspaceId: string): Promise<WatchItem[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.marketWatchItem.findMany({ where: { workspaceId }, orderBy: [{ market: "asc" }, { symbol: "asc" }] });
    });
    return rows.map(toWatchDto);
  }

  async addWatch(userId: string, workspaceId: string, input: CreateWatchItemInput): Promise<WatchItem> {
    try {
      const row = await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
        return tx.marketWatchItem.create({
          data: { workspaceId, market: input.market.toLowerCase(), symbol: input.symbol.toUpperCase(), name: input.name, note: input.note }
        });
      });
      return toWatchDto(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Этот инструмент уже в списке наблюдения");
      }
      throw error;
    }
  }

  async updateWatch(userId: string, workspaceId: string, itemId: string, input: UpdateWatchItemInput): Promise<WatchItem> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const existing = await tx.marketWatchItem.findUnique({ where: { id: itemId } });
      if (!existing || existing.workspaceId !== workspaceId) throw new NotFoundException("Инструмент не найден");
      return tx.marketWatchItem.update({ where: { id: itemId }, data: input });
    });
    return toWatchDto(row);
  }

  async removeWatch(userId: string, workspaceId: string, itemId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const existing = await tx.marketWatchItem.findUnique({ where: { id: itemId } });
      if (!existing || existing.workspaceId !== workspaceId) throw new NotFoundException("Инструмент не найден");
      await tx.marketWatchItem.delete({ where: { id: itemId } });
    });
  }

  // ---- trades

  listTrades(userId: string, workspaceId: string, mode?: TradeMode): Promise<InvestmentTrade[]> {
    return this.trades.listTrades(userId, workspaceId, mode);
  }

  importTrades(userId: string, workspaceId: string, input: TradeImportInput): Promise<TradeImportResult> {
    return this.trades.importTrades(userId, workspaceId, input);
  }

  removeTrade(userId: string, workspaceId: string, tradeId: string): Promise<void> {
    return this.trades.removeTrade(userId, workspaceId, tradeId);
  }

  recordFee(userId: string, workspaceId: string, tradeId: string, input: RecordTradeFeeInput): Promise<InvestmentTrade> {
    return this.trades.recordFee(userId, workspaceId, tradeId, input);
  }
}

function toWatchDto(row: { id: string; workspaceId: string; market: string; symbol: string; name: string; note: string; createdAt: Date }): WatchItem {
  return { id: row.id, workspaceId: row.workspaceId, market: row.market, symbol: row.symbol, name: row.name, note: row.note, createdAt: row.createdAt.toISOString() };
}
