import type { InvestmentTrade, TradeMode, TradeImportInput, TradeImportResult, RecordTradeFeeInput } from "@orion/shared-types";

/** Finance-owned investment journal and explicit fee bridge. No automatic buy/sell posting. */
export abstract class InvestmentJournal {
  abstract listTrades(userId: string, workspaceId: string, mode?: TradeMode): Promise<InvestmentTrade[]>;
  abstract importTrades(userId: string, workspaceId: string, input: TradeImportInput): Promise<TradeImportResult>;
  abstract removeTrade(userId: string, workspaceId: string, tradeId: string): Promise<void>;
  abstract recordFee(userId: string, workspaceId: string, tradeId: string, input: RecordTradeFeeInput): Promise<InvestmentTrade>;
}
