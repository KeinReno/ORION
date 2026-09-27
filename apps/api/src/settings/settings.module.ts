import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";

@Module({
  // NotificationsModule for NotificationPolicyService: saving preferences has
  // to invalidate the reminder-policy cache immediately. WorkspacesModule for
  // WorkspacesService: U05 sphere/favorite mutations validate membership
  // (`assertMember`) and read the caller's current workspace list
  // (`listForUser`) to lazily filter spheres/favorites.
  imports: [AuthModule, NotificationsModule, WorkspacesModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService]
})
export class SettingsModule {}
