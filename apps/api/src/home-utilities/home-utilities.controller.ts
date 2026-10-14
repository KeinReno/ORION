import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { electricityTariffInputSchema, importUtilityMonthsInputSchema, putUtilityMonthInputSchema, putUtilityPaymentInputSchema, utilityPeriodSchema, type ElectricityTariffInput, type ImportUtilityMonthsInput, type PutUtilityMonthInput, type PutUtilityPaymentInput } from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequirePlugin } from "../plugins/require-plugin";
import { HomeUtilitiesService } from "./home-utilities.service";

@RequirePlugin("home-utilities")
@Controller("workspaces/:workspaceId/home-utilities/:homeId")
export class HomeUtilitiesController {
  constructor(private readonly utilities: HomeUtilitiesService) {}

  @Get("months")
  months(@CurrentUser() user: RequestUser, @Param("workspaceId") ws: string, @Param("homeId") homeId: string) {
    return this.utilities.months(user.userId, ws, homeId);
  }

  @Post("months/import")
  importMonths(@CurrentUser() user: RequestUser, @Param("workspaceId") ws: string, @Param("homeId") homeId: string,
    @Body(new ZodValidationPipe(importUtilityMonthsInputSchema)) input: ImportUtilityMonthsInput) {
    return this.utilities.importMonths(user.userId, ws, homeId, input);
  }

  @Put("months/:period")
  putMonth(@CurrentUser() user: RequestUser, @Param("workspaceId") ws: string, @Param("homeId") homeId: string,
    @Param("period", new ZodValidationPipe(utilityPeriodSchema)) period: string,
    @Body(new ZodValidationPipe(putUtilityMonthInputSchema)) input: PutUtilityMonthInput) {
    return this.utilities.putMonth(user.userId, ws, homeId, period, input);
  }

  @Post("months/:period/copy-previous")
  copyPrevious(@CurrentUser() user: RequestUser, @Param("workspaceId") ws: string, @Param("homeId") homeId: string,
    @Param("period", new ZodValidationPipe(utilityPeriodSchema)) period: string) {
    return this.utilities.copyPrevious(user.userId, ws, homeId, period);
  }

  @Put("months/:period/payments")
  putPayment(@CurrentUser() user: RequestUser, @Param("workspaceId") ws: string, @Param("homeId") homeId: string,
    @Param("period", new ZodValidationPipe(utilityPeriodSchema)) period: string,
    @Body(new ZodValidationPipe(putUtilityPaymentInputSchema)) input: PutUtilityPaymentInput) {
    return this.utilities.putPayment(user.userId, ws, homeId, period, input);
  }

  @Delete("months/:period/payments/:paymentId")
  removePayment(@CurrentUser() user: RequestUser, @Param("workspaceId") ws: string, @Param("homeId") homeId: string,
    @Param("period", new ZodValidationPipe(utilityPeriodSchema)) period: string, @Param("paymentId") paymentId: string) {
    return this.utilities.removePayment(user.userId, ws, homeId, period, paymentId);
  }

  @Get("meters/:meterId/tariffs")
  tariffs(@CurrentUser() user: RequestUser, @Param("workspaceId") ws: string, @Param("homeId") homeId: string, @Param("meterId") meterId: string) {
    return this.utilities.tariffs(user.userId, ws, homeId, meterId);
  }

  @Post("meters/:meterId/tariffs")
  addTariff(@CurrentUser() user: RequestUser, @Param("workspaceId") ws: string, @Param("homeId") homeId: string, @Param("meterId") meterId: string,
    @Body(new ZodValidationPipe(electricityTariffInputSchema)) input: ElectricityTariffInput) {
    return this.utilities.addTariff(user.userId, ws, homeId, meterId, input);
  }
}
