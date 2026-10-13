import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import type { ActivityEntry } from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ActivityService } from "./activity.service";

@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/activity")
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  feed(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<ActivityEntry[]> {
    return this.activity.feed(user.userId, workspaceId);
  }
}
