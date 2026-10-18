import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";
import { TaskCommentsService } from "./task-comments.service";
import { TaskActivityService } from "./task-activity.service";
import { TasksProjectAggregates } from "./tasks-project-aggregates";
import { TaskClosedNotifier } from "./task-closed-notifier";

@Module({
  imports: [AuthModule, WorkspacesModule, NotificationsModule],
  controllers: [TasksController],
  providers: [TasksProjectAggregates, TasksService, TaskCommentsService, TaskActivityService, TaskClosedNotifier],
  exports: [TasksService]
})
export class TasksModule {}
