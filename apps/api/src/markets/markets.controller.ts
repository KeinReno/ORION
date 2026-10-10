import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createWatchItemInputSchema,
  recordTradeFeeInputSchema,
  tradeImportInputSchema,
  tradeModeSchema,
  updateWatchItemInputSchema,
  type CreateWatchItemInput,
  type InvestmentTrade,
  type RecordTradeFeeInput,
  type TradeImportInput,
  type TradeImportResult,
  type UpdateWatchItemInput,
  type WatchItem
} from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequireModule } from "../modules/require-module";
import { MarketsService } from "./markets.service";

@RequireModule("markets")
@Controller("workspaces/:workspaceId/markets")
export class MarketsController {
  constructor(private readonly markets: MarketsService) {}

  @Get("watchlist")
  listWatch(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<WatchItem[]> {
    return this.markets.listWatch(user.userId, workspaceId);
  }

  @Post("watchlist")
  addWatch(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createWatchItemInputSchema)) body: CreateWatchItemInput
  ): Promise<WatchItem> {
    return this.markets.addWatch(user.userId, workspaceId, body);
  }

  @Patch("watchlist/:itemId")
  updateWatch(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(updateWatchItemInputSchema)) body: UpdateWatchItemInput
  ): Promise<WatchItem> {
    return this.markets.updateWatch(user.userId, workspaceId, itemId, body);
  }

  @Delete("watchlist/:itemId")
  removeWatch(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("itemId") itemId: string): Promise<void> {
    return this.markets.removeWatch(user.userId, workspaceId, itemId);
  }

  @Get("trades")
  listTrades(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Query("mode") mode?: string): Promise<InvestmentTrade[]> {
    const parsed = mode ? tradeModeSchema.safeParse(mode) : null;
    return this.markets.listTrades(user.userId, workspaceId, parsed?.success ? parsed.data : undefined);
  }

  /** Registered before `trades/:tradeId` so "import" is never read as an id. */
  @Post("trades/import")
  @HttpCode(201)
  importTrades(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(tradeImportInputSchema)) body: TradeImportInput
  ): Promise<TradeImportResult> {
    return this.markets.importTrades(user.userId, workspaceId, body);
  }

  @Post("trades/:tradeId/fee")
  @HttpCode(201)
  recordFee(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("tradeId") tradeId: string,
    @Body(new ZodValidationPipe(recordTradeFeeInputSchema)) body: RecordTradeFeeInput
  ): Promise<InvestmentTrade> {
    return this.markets.recordFee(user.userId, workspaceId, tradeId, body);
  }

  @Delete("trades/:tradeId")
  removeTrade(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("tradeId") tradeId: string): Promise<void> {
    return this.markets.removeTrade(user.userId, workspaceId, tradeId);
  }
}
