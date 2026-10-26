import { ProjectReferencesModule } from "../projects/public/project-references.module";
import { TaskIntegrationReaderModule } from "../tasks/public/task-integration-reader.module";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { EventsController } from "./events.controller";
import { CalendarController } from "./calendar.controller";
import { CalendarFeedController } from "./calendar-feed.controller";
import { EventOperationsModule } from "./public/event-operations.module";
import { EventReminderService } from "./event-reminder.service";
import { CalendarConnectionsController } from "./calendar-connections.controller";
import { CalendarConnectionsService } from "./calendar-connections.service";
import { SearchRegistryModule } from "../search/search-registry.module";
import { InboxRegistryModule } from "../inbox/inbox-registry.module";
import { EventsSearchProvider } from "./events-search.provider";
import { EventInboxTarget } from "./events-inbox.target";
import { EventsProjectAggregates } from "./events-project-aggregates";

@Module({
  imports: [EventOperationsModule, ProjectReferencesModule, TaskIntegrationReaderModule, AuthModule, WorkspacesModule, NotificationsModule, SearchRegistryModule, InboxRegistryModule],
  controllers: [EventsController, CalendarController, CalendarFeedController, CalendarConnectionsController],
  providers: [EventsProjectAggregates, EventReminderService, CalendarConnectionsService, EventsSearchProvider, EventInboxTarget],
  exports: [EventOperationsModule]
})
export class EventsModule {}
