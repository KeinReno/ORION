import { Module } from "@nestjs/common";
import { EntityLinksModule } from "../../entity-links/entity-links.module";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { TaskOperationsModule } from "../../tasks/public/task-operations.module";
import { NoteOperationsModule } from "../../notes/public/note-operations.module";
import { SearchRegistryModule } from "../search-registry.module";
import { SearchService } from "../search.service";
import { SearchOperations } from "./search-operations";

@Module({ imports: [WorkspacesModule, EntityLinksModule, TaskOperationsModule, NoteOperationsModule, SearchRegistryModule],
  providers: [SearchService, { provide: SearchOperations, useFactory: (service: SearchService): SearchOperations => service, inject: [SearchService] }],
  exports: [SearchOperations, SearchService] })
export class SearchOperationsModule {}
