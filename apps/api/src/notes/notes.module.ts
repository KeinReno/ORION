import { ProjectReferencesModule } from "../projects/public/project-references.module";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DocumentAttachmentStoreModule } from "../documents/public/document-attachment-store.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { NoteAttachmentsService } from "./note-attachments.service";
import { NotesController } from "./notes.controller";
import { NoteOperationsModule } from "./public/note-operations.module";
import { NoteTrashPurgeService } from "./note-trash-purge.service";
import { SearchRegistryModule } from "../search/search-registry.module";
import { InboxRegistryModule } from "../inbox/inbox-registry.module";
import { NotesSearchProvider } from "./notes-search.provider";
import { NoteInboxTarget } from "./notes-inbox.target";
import { NotesProjectAggregates } from "./notes-project-aggregates";

/**
 * Note attachments reuse the documents module's storage: `DocumentAttachmentStoreModule`
 * exports the document attachment storage contract, which owns uploads, dedup names and storage
 * keys. One-way dependency (documents never imports notes), so no cycle.
 */
@Module({
  imports: [NoteOperationsModule, ProjectReferencesModule, AuthModule, WorkspacesModule, DocumentAttachmentStoreModule, SearchRegistryModule, InboxRegistryModule],
  controllers: [NotesController],
  providers: [NotesProjectAggregates, NoteTrashPurgeService, NoteAttachmentsService, NotesSearchProvider, NoteInboxTarget],
  exports: [NoteOperationsModule]
})
export class NotesModule {}
