import { ProjectTaskLinksModule } from "../projects/public/project-task-links.module";
import { MilestoneReferencesModule } from "../milestones/public/milestone-references.module";
import { TasksPublicationAdapter } from "./tasks-publication.adapter";
import { PublicationRegistryModule } from "../shared/publication-registry";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TasksController } from "./tasks.controller";
import { TaskOperationsModule } from "./public/task-operations.module";
import { TaskCommentsService } from "./task-comments.service";
import { TaskActivityService } from "./task-activity.service";
import { SearchRegistryModule } from "../search/search-registry.module";
import { InboxRegistryModule } from "../inbox/inbox-registry.module";
import { TasksSearchProvider } from "./tasks-search.provider";
import { TaskInboxTarget } from "./tasks-inbox.target";
import { TasksProjectAggregates } from "./tasks-project-aggregates";
import { TaskClosedNotifier } from "./task-closed-notifier";
import { TaskClosureRegistryModule } from "./public/task-closure-registry";
import { PublishedSourcesModule } from "../shared/public/published-source";
import { TaskStatusesController } from "./task-statuses.controller";
import { TaskFieldsController, TaskValuesController } from "./task-fields.controller";
import { TasksBulkController } from "./tasks-bulk.controller";
import { TasksRecurrenceController } from "./tasks-recurrence.controller";
import { TasksBulkService } from "./tasks-bulk.service";

@Module({
  imports: [
    TaskOperationsModule,
    ProjectTaskLinksModule,
    MilestoneReferencesModule,
    TaskClosureRegistryModule,
    PublicationRegistryModule,
    PublishedSourcesModule,
    AuthModule,
    WorkspacesModule,
    NotificationsModule,
    SearchRegistryModule,
    InboxRegistryModule
  ],
  controllers: [
    TasksController,
    TaskStatusesController,
    TaskFieldsController,
    TaskValuesController,
    TasksBulkController,
    TasksRecurrenceController
  ],
  providers: [
    TasksPublicationAdapter,
    TasksProjectAggregates,
    TaskCommentsService,
    TaskActivityService,
    TaskClosedNotifier,
    TasksSearchProvider,
    TaskInboxTarget,
    TasksBulkService
  ],
  exports: [TaskOperationsModule]
})
export class TasksModule {}
