import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotificationsController } from "./notifications.controller";
import { TelegramService } from "./telegram.service";
import { DueTaskCheckerService } from "./due-task-checker.service";

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [TelegramService, DueTaskCheckerService]
})
export class NotificationsModule {}
