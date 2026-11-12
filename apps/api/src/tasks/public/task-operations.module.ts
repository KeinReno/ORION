import { HomeReferencesModule } from "../../home/public/home-references.module";
import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { ProjectTaskLinksModule } from "../../projects/public/project-task-links.module";
import { MilestoneReferencesModule } from "../../milestones/public/milestone-references.module";
import { TaskClosureRegistryModule } from "./task-closure-registry";
import { TaskAgentAssignmentRegistryModule } from "./task-agent-assignment-registry";
import { TasksService } from "../tasks.service";
import { TaskStatusesService } from "../task-statuses.service";
import { TaskFieldsService } from "../task-fields.service";
import { TaskRecurrenceService } from "../tasks-recurrence.service";
import { TaskOperations } from "./task-operations";

/**
 * Shared command implementation; no task controllers, listeners or provider
 * registrations. Tasks 2.0 statuses/fields/recurrence live here because
 * `TasksService` injects them and is itself instantiated from this module.
 */
@Module({
  imports: [HomeReferencesModule, WorkspacesModule, ProjectTaskLinksModule, MilestoneReferencesModule, TaskClosureRegistryModule, TaskAgentAssignmentRegistryModule],
  providers: [
    TasksService,
    TaskStatusesService,
    TaskFieldsService,
    TaskRecurrenceService,
    { provide: TaskOperations, useFactory: (service: TasksService): TaskOperations => service, inject: [TasksService] }
  ],
  exports: [TaskOperations, TasksService, TaskStatusesService, TaskFieldsService, TaskRecurrenceService]
})
export class TaskOperationsModule {}
