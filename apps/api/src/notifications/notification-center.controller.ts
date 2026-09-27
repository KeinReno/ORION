import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { Notification } from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { NotificationCenterService } from "./notification-center.service";

@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/notifications")
export class NotificationCenterController {
  constructor(private readonly notifications: NotificationCenterService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Query("unread") unread?: string): Promise<Notification[]> {
    return this.notifications.list(user.userId, workspaceId, unread === "true");
  }

  @Patch(":notificationId/read")
  markRead(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("notificationId") notificationId: string): Promise<Notification> {
    return this.notifications.markRead(user.userId, workspaceId, notificationId, true);
  }

  @Patch(":notificationId/unread")
  markUnread(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("notificationId") notificationId: string): Promise<Notification> {
    return this.notifications.markRead(user.userId, workspaceId, notificationId, false);
  }

  @Post("read-all")
  markAllRead(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<{ updated: number }> {
    return this.notifications.markAllRead(user.userId, workspaceId);
  }

  @Delete(":notificationId")
  @HttpCode(204)
  remove(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("notificationId") notificationId: string): Promise<void> {
    return this.notifications.remove(user.userId, workspaceId, notificationId);
  }
}
