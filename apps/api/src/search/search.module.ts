import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TasksModule } from "../tasks/tasks.module";
import { NotesModule } from "../notes/notes.module";
import { SearchRegistryModule } from "./search-registry.module";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";
import { RemindersController } from "./reminders.controller";
import { RemindersService } from "./reminders.service";
import { ReminderCheckerService } from "./reminder-checker.service";

// U03: reminders live next to entity-links/search rather than in their own
// top-level app module — they share the same closed entity registry
// (ENTITY_REGISTRY) and module-access gate as `links`, and NotificationsModule
// (already imported here for NotificationCenterService/NotificationPolicyService)
// is what ReminderCheckerService delivers through. TasksModule/NotesModule
// (exporting TasksService/NotesService) are imported so `createAndLink`
// (U03 Часть 1) can call their `createTx` inside its own transaction — a
// one-way dependency (search -> tasks/notes), no cycle.
@Module({
  imports: [AuthModule, WorkspacesModule, NotificationsModule, TasksModule, NotesModule, SearchRegistryModule],
  controllers: [SearchController, RemindersController],
  providers: [SearchService, RemindersService, ReminderCheckerService],
  exports: [SearchService]
})
export class SearchModule {}
