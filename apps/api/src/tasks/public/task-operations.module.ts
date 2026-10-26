import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { ProjectTaskLinksModule } from "../../projects/public/project-task-links.module";
import { MilestoneReferencesModule } from "../../milestones/public/milestone-references.module";
import { TaskClosureRegistryModule } from "./task-closure-registry";
import { TasksService } from "../tasks.service";
import { TaskOperations } from "./task-operations";

/** Shared command implementation; no task controllers, listeners or provider registrations. */
@Module({
  imports: [WorkspacesModule, ProjectTaskLinksModule, MilestoneReferencesModule, TaskClosureRegistryModule],
  providers: [TasksService, { provide: TaskOperations, useFactory: (service: TasksService): TaskOperations => service, inject: [TasksService] }],
  exports: [TaskOperations, TasksService]
})
export class TaskOperationsModule {}
