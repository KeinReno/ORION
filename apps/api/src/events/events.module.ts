import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { EventsController } from "./events.controller";
import { CalendarController } from "./calendar.controller";
import { CalendarFeedController } from "./calendar-feed.controller";
import { EventsService } from "./events.service";
import { EventReminderService } from "./event-reminder.service";
import { CalendarConnectionsController } from "./calendar-connections.controller";
import { CalendarConnectionsService } from "./calendar-connections.service";

@Module({
  imports: [AuthModule, WorkspacesModule, NotificationsModule],
  controllers: [EventsController, CalendarController, CalendarFeedController, CalendarConnectionsController],
  providers: [EventsService, EventReminderService, CalendarConnectionsService]
})
export class EventsModule {}
