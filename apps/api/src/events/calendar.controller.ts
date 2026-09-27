import { Controller, Get, Param, Post } from "@nestjs/common";
import type { CalendarFeedInfo } from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequireModule } from "../modules/require-module";
import { EventsService } from "./events.service";

/**
 * Guarded settings endpoints for the read-only .ics subscription. The feed
 * itself (unauthenticated, token-gated) is CalendarFeedController.
 */
@RequireModule("calendar")
@Controller("workspaces/:workspaceId/calendar")
export class CalendarController {
  constructor(private readonly events: EventsService) {}

  @Get("feed")
  feed(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<CalendarFeedInfo> {
    return this.events.feedInfo(user.userId, workspaceId);
  }

  @Post("feed/rotate")
  rotate(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<CalendarFeedInfo> {
    return this.events.rotateFeedToken(user.userId, workspaceId);
  }
}
