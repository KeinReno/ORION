import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotificationsController } from "./notifications.controller";
import { TelegramService } from "./telegram.service";
import { DueTaskCheckerService } from "./due-task-checker.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { NotificationCenterController } from "./notification-center.controller";
import { NotificationCenterService } from "./notification-center.service";
import { NotificationPolicyService } from "./notification-policy.service";
import { MentionsService } from "./mentions.service";

@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [NotificationsController, NotificationCenterController],
  providers: [TelegramService, DueTaskCheckerService, NotificationCenterService, NotificationPolicyService, MentionsService],
  // EventsModule's reminder cron reuses the same delivery path; FinanceModule
  // asks NotificationPolicyService before raising a budget alert. MentionsService —
  // общий разбор `@имя` для комментариев задач и записей журнала проекта (задание 12.3).
  exports: [TelegramService, NotificationCenterService, NotificationPolicyService, MentionsService]
})
export class NotificationsModule {}
