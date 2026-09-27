import { Controller, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { DueTaskCheckerService } from "./due-task-checker.service";

@UseGuards(JwtAuthGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly checker: DueTaskCheckerService) {}

  /**
   * Manual trigger for testing — scoped to the caller's own workspaces only.
   * The system-wide cron (DueTaskCheckerService.runCheck) is never reachable
   * from here, so an authenticated user can't trigger a scan/notification
   * over other users' data.
   */
  @Post("check-due")
  checkDue(@CurrentUser() user: RequestUser): Promise<{ notified: number; skipped: number }> {
    return this.checker.runCheckForUser(user.userId);
  }
}
