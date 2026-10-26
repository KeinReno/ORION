import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { ProjectReferencesModule } from "../../projects/public/project-references.module";
import { NotesService } from "../notes.service";
import { NoteOperations } from "./note-operations";

/** Commands only; no attachments, controllers or trash cron. */
@Module({
  imports: [WorkspacesModule, ProjectReferencesModule],
  providers: [NotesService, { provide: NoteOperations, useFactory: (service: NotesService): NoteOperations => service, inject: [NotesService] }],
  exports: [NoteOperations, NotesService]
})
export class NoteOperationsModule {}
