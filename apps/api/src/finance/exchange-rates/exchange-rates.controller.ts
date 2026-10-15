import { Body, Controller, Delete, Get, HttpCode, Param, Put } from "@nestjs/common";
import { upsertExchangeRateInputSchema, type ExchangeRate, type UpsertExchangeRateInput } from "@orion/shared-types";
import { RequireModule } from "../../modules/require-module";
import { CurrentUser } from "../../common/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { RequestUser } from "../../auth/jwt.strategy";
import { RequirePlugin } from "../../plugins/require-plugin";
import { ExchangeRatesService } from "./exchange-rates.service";

@RequireModule("finance")
@RequirePlugin("finance-exchange-rates")
@Controller("workspaces/:workspaceId/finance/exchange-rates")
export class ExchangeRatesController {
  constructor(private readonly rates: ExchangeRatesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<ExchangeRate[]> {
    return this.rates.list(user.userId, workspaceId);
  }

  /** Idempotent by (pair, day): entering the same day again replaces the rate. */
  @Put()
  @HttpCode(200)
  upsert(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(upsertExchangeRateInputSchema)) body: UpsertExchangeRateInput
  ): Promise<ExchangeRate> {
    return this.rates.upsert(user.userId, workspaceId, body);
  }

  @Delete(":rateId")
  remove(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("rateId") rateId: string): Promise<void> {
    return this.rates.remove(user.userId, workspaceId, rateId);
  }
}
