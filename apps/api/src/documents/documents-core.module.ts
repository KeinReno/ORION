import { Module } from "@nestjs/common";
import { ProjectReferencesModule } from "../projects/public/project-references.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { DocumentsService } from "./documents.service";

/** Storage commands without controllers, search registration or trash cron. */
@Module({ imports: [ProjectReferencesModule, WorkspacesModule], providers: [DocumentsService], exports: [DocumentsService] })
export class DocumentsCoreModule {}
