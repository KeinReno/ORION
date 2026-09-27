import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotificationsController } from "./notifications.controller";
import { TelegramService } from "./telegram.service";
import { DueTaskCheckerService } from "./due-task-checker.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { NotificationCenterController } from "./notification-center.controller";
import { NotificationCenterService } from "./notification-center.service";
import { NotificationPolicyService } from "./notification-policy.service";

@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [NotificationsController, NotificationCenterController],
  providers: [TelegramService, DueTaskCheckerService, NotificationCenterService, NotificationPolicyService],
  // EventsModule's reminder cron reuses the same delivery path; FinanceModule
  // asks NotificationPolicyService before raising a budget alert.
  exports: [TelegramService, NotificationCenterService, NotificationPolicyService]
})
export class NotificationsModule {}
