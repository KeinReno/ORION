import { Controller, Get, Param, Query } from "@nestjs/common";
import type { CategoryBreakdownEntry, MonthlyFinanceSummary } from "@orion/shared-types";
import { RequireModule } from "../../modules/require-module";
import { CurrentUser } from "../../common/current-user.decorator";
import type { RequestUser } from "../../auth/jwt.strategy";
import { ReportsService } from "./reports.service";

@RequireModule("finance")
@Controller("workspaces/:workspaceId/finance/reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("monthly")
  monthly(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("months") months?: string
  ): Promise<MonthlyFinanceSummary[]> {
    const parsed = Number(months);
    return this.reports.monthlySummary(user.userId, workspaceId, Number.isFinite(parsed) && parsed > 0 ? parsed : 6);
  }

  @Get("categories")
  categories(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("month") month?: string,
    @Query("from") from?: string,
    @Query("to") to?: string
  ): Promise<CategoryBreakdownEntry[]> {
    return this.reports.categoryBreakdown(user.userId, workspaceId, { month, from, to });
  }
}
