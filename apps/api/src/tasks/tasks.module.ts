import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";
import { TaskCommentsService } from "./task-comments.service";
import { TaskActivityService } from "./task-activity.service";
import { SearchRegistryModule } from "../search/search-registry.module";
import { InboxRegistryModule } from "../inbox/inbox-registry.module";
import { TasksSearchProvider } from "./tasks-search.provider";
import { TaskInboxTarget } from "./tasks-inbox.target";

@Module({
  imports: [AuthModule, WorkspacesModule, NotificationsModule, SearchRegistryModule, InboxRegistryModule],
  controllers: [TasksController],
  providers: [TasksService, TaskCommentsService, TaskActivityService, TasksSearchProvider, TaskInboxTarget],
  exports: [TasksService]
})
export class TasksModule {}
