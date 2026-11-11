import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TaskOperationsModule } from "../tasks/public/task-operations.module";
import { NoteOperationsModule } from "../notes/public/note-operations.module";
import { SearchRegistryModule } from "./search-registry.module";
import { SearchController } from "./search.controller";
import { GlobalSearchController } from "./global-search.controller";
import { SearchOperationsModule } from "./public/search-operations.module";
import { RemindersController } from "./reminders.controller";
import { RemindersService } from "./reminders.service";
import { ReminderCheckerService } from "./reminder-checker.service";

// Search uses public creation commands in its existing link transaction.
// Domain controllers, registrations and scheduled work are not loaded by these SDKs.
@Module({
  imports: [SearchOperationsModule, AuthModule, WorkspacesModule, NotificationsModule, TaskOperationsModule, NoteOperationsModule, SearchRegistryModule],
  controllers: [SearchController, GlobalSearchController, RemindersController],
  providers: [ RemindersService, ReminderCheckerService],
  exports: [SearchOperationsModule]
})
export class SearchModule {}
