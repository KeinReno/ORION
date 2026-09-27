import { Controller, Get, UseGuards } from "@nestjs/common";
import type { MyOverview } from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { OverviewService } from "./overview.service";

/**
 * Not `workspaces/:workspaceId/...` — deliberately, unlike every other
 * domain controller (CLAUDE.md module contract, invariant #1). This is a
 * per-user aggregation across every workspace the caller is already a
 * member of, so there is no single workspaceId to scope the route under.
 * See OverviewService's doc comment for why that's safe.
 */
@UseGuards(JwtAuthGuard)
@Controller("me")
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get("overview")
  getOverview(@CurrentUser() user: RequestUser): Promise<MyOverview> {
    return this.overview.getMyOverview(user.userId);
  }
}
