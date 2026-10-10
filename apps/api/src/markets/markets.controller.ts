import { All, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  createWatchItemInputSchema,
  recordTradeFeeInputSchema,
  tradeImportInputSchema,
  tradeModeSchema,
  updateWatchItemInputSchema,
  compassBackupToEntries,
  type CompassEngineStatus,
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
import { WorkspacesService } from "../workspaces/workspaces.service";
import { CompassEngineService } from "./compass-engine.service";
import { MarketsService } from "./markets.service";

@RequireModule("markets")
@Controller("workspaces/:workspaceId/markets")
export class MarketsController {
  constructor(
    private readonly markets: MarketsService,
    private readonly engine: CompassEngineService,
    private readonly workspaces: WorkspacesService
  ) {}

  @Get("engine")
  async engineStatus(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<CompassEngineStatus> {
    await this.workspaces.assertMember(user.userId, workspaceId);
    return this.engine.status(workspaceId);
  }

  @Post("engine/start")
  @HttpCode(200)
  async engineStart(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<CompassEngineStatus> {
    await this.workspaces.assertMember(user.userId, workspaceId);
    return this.engine.start(workspaceId);
  }

  /** Забрать журнал из работающего Compass (без файла резервной копии): те же правила, что у импорта — идемпотентность по uid, режим сделки сохраняется. */
  @Post("engine/sync-journal")
  @HttpCode(200)
  async engineSyncJournal(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<TradeImportResult & { skippedDeleted: number; problems: string[] }> {
    await this.workspaces.assertMember(user.userId, workspaceId);
    const parsed = compassBackupToEntries(await this.engine.journalBackup(workspaceId));
    if (parsed.entries.length === 0) return { dryRun: false, imported: 0, duplicates: 0, byMode: { real: 0, paper: 0, historical: 0 }, skippedDeleted: parsed.skippedDeleted, problems: parsed.problems };
    const result = await this.markets.importTrades(user.userId, workspaceId, { source: "compass", dryRun: false, entries: parsed.entries });
    return { ...result, skippedDeleted: parsed.skippedDeleted, problems: parsed.problems };
  }

  /** Весь API Compass для панелей ORION (`…/engine/api/journal`, `…/engine/api/backtest` …): проверка членства и модуля — здесь, дальше — движок. */
  @All("engine/api/*")
  async engineProxy(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    await this.workspaces.assertMember(user.userId, workspaceId);
    const rest = req.url.slice(req.url.indexOf("/engine/api/") + "/engine".length);
    const result = await this.engine.proxy(workspaceId, req.method, rest, req.body);
    res.status(result.status).type(result.contentType).send(result.body);
  }

  @Post("engine/stop")
  @HttpCode(200)
  async engineStop(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<CompassEngineStatus> {
    await this.workspaces.assertMember(user.userId, workspaceId);
    return this.engine.stop(workspaceId);
  }

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
