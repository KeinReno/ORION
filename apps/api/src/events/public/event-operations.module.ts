import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { ProjectReferencesModule } from "../../projects/public/project-references.module";
import { TaskIntegrationReaderModule } from "../../tasks/public/task-integration-reader.module";
import { EventsService } from "../events.service";
import { EventOperations } from "./event-operations";

@Module({ imports: [WorkspacesModule, ProjectReferencesModule, TaskIntegrationReaderModule],
  providers: [EventsService, { provide: EventOperations, useFactory: (service: EventsService): EventOperations => service, inject: [EventsService] }],
  exports: [EventOperations, EventsService] })
export class EventOperationsModule {}
